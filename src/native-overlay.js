/* EvidenceWeave, a lightweight overlay on Obsidian's ORIGINAL graph.
 * Never draws/rearranges nodes or connections and never creates new notes.
 */
'use strict';
const ewEl=(tag,klass,parent,content)=>{
  const el=document.createElement(tag);
  if (klass) el.className=klass;
  if (content!==undefined) el.textContent=String(content);
  if (parent) parent.appendChild(el);
  return el;
};
const ewIsPdfLink=url=>/\.pdf(?:[?#]|$)/i.test(url||'');
const ewIsPdfFile=file=>!!(file&&file.extension==='pdf');
const ewPair=(a,b)=>[a,b].sort().join('\n');

/** Resolve EXACTLY the edge Obsidian actually renders. Never make synthetic edges. */
function matchNativeRelation(sourcePath,targetPath,model,overviewPath) {
  const nodeByPath=new Map(model.nodes.map(n=>[n.path,n]));
  const a=nodeByPath.get(sourcePath),b=nodeByPath.get(targetPath);
  const matches=[];
  if(a&&b){
    for(const rel of model.edges){
      if(rel.kind==='wikilink') continue;
      if(ewPair(rel.source,rel.target)===ewPair(a.id,b.id)) matches.push({relation:rel,proxy:false});
    }
  }
  // INSES/M00 notes describe C00→Pxx relationships, while the native graph
  // actually draws M00→Pxx because M00 contains those wikilinks.
  const otherPath=sourcePath===overviewPath?targetPath:targetPath===overviewPath?sourcePath:'';
  const targetNode=nodeByPath.get(otherPath);
  if(targetNode){
    for(const rel of model.edges){
      if(rel.kind==='overview' && rel.storage?.note===overviewPath && rel.target===targetNode.id &&
          !matches.some(m=>m.relation.id===rel.id)) matches.push({relation:rel,proxy:true});
    }
  }
  return matches;
}
function viewpointForNativeRelation(focusPath,relation,nodeByPath,overviewPath) {
  if(focusPath===overviewPath&&relation.kind==='overview') return relation.source;
  const node=nodeByPath.get(focusPath);
  if(!node) return '';
  return node.id===relation.source || node.id===relation.target ? node.id : '';
}
function nodeFromGraphPath(path,model){return model.nodes.find(n=>n.path===path)||null;}
function isFileGraphNode(id){return typeof id==='string' && id.endsWith('.md');}

class NativeGraphBinding {
  constructor(plugin,leaf,renderer) {
    this.plugin=plugin;this.leaf=leaf;
    this.adapter=new NativeGraphAdapter(renderer);
    this.lockedPath='';this.focusPath='';this.labels=[];
    this.destroyed=false;this.editing=null;this.seq=0;this.pdfKey='';
    this.isInPopup=false;this.hoveringLabel=false;this.pointerInGraph=false;
    this.lastNodePoint=null;this.rafId=0;this.refreshTimers=[];this.down=null;
    this.pdfComponent=null;
    this.onDown=e=>this.handlePointerDown(e);
    this.onUp=e=>this.handlePointerUp(e);
    this.onEnter=()=>{this.pointerInGraph=true;};
    this.onLeave=e=>{if(!this.popup?.contains(e.relatedTarget))this.pointerInGraph=false;};
  }
  attach(){
    const host=this.adapter.getContainer();
    if(!host || this.destroyed) return;
    this.previousInlinePosition=host.style.position;
    if(getComputedStyle(host).position==='static')host.style.position='relative';
    this.overlay=ewEl('div','ew-native-overlay',host);
    this.overlay.setAttribute('aria-label','EvidenceWeave 原生图谱关系增强');
    this.labelLayer=ewEl('div','ew-native-label-layer',this.overlay);
    this.popup=ewEl('section','ew-native-pdf',this.overlay);
    this.popup.hidden=true;
    this.popup.setAttribute('aria-label','原文 PDF 快速预览');
    this.popup.addEventListener('pointerenter',()=>{this.isInPopup=true;});
    this.popup.addEventListener('pointerleave',()=>{this.isInPopup=false;});
    host.addEventListener('pointerdown',this.onDown,true);
    host.addEventListener('pointerup',this.onUp,true);
    host.addEventListener('pointerenter',this.onEnter);
    host.addEventListener('pointerleave',this.onLeave);
    this.adapter.mount((event,id,type)=>this.onNodeClick(event,id,type),()=>{
      const pinned=this.lockedPath || ((this.isInPopup||this.hoveringLabel||this.editing)?this.focusPath:'');
      return pinned?this.adapter.getNode(pinned):null;
    });
    this.rafId=requestAnimationFrame(()=>this.tick());
  }
  detach(){
    if(this.destroyed)return;
    this.destroyed=true;
    cancelAnimationFrame(this.rafId);this.clearRepaintTimers();
    this.disposePdfComponent();
    const host=this.adapter.getContainer();
    host?.removeEventListener('pointerdown',this.onDown,true);
    host?.removeEventListener('pointerup',this.onUp,true);
    host?.removeEventListener('pointerenter',this.onEnter);
    host?.removeEventListener('pointerleave',this.onLeave);
    if(host && this.previousInlinePosition!==undefined)host.style.position=this.previousInlinePosition;
    this.adapter.unmount();
    this.overlay?.remove();
    this.overlay=null;
  }
  onNodeClick(event,id,type){
    if(!isFileGraphNode(id)||!this.plugin.isScopedPath(id))return false;
    // Cmd/Ctrl+Click continues to use Obsidian's native open-note behavior.
    if(event?.metaKey||event?.ctrlKey||event?.shiftKey||event?.altKey)return false;
    if(event && event.button!==undefined && event.button!==0)return false;
    this.lock(id);
    return true;
  }
  lock(path){
    this.lockedPath=path;
    this.pointerInGraph=true;
    this.setFocus(path);
    this.adapter.repaint();
    this.clearRepaintTimers();
    for(const delay of [40,120,290,550])this.refreshTimers.push(setTimeout(()=>{
      if(!this.destroyed&&this.lockedPath)this.adapter.repaint();
    },delay));
  }
  clearRepaintTimers(){for(const t of this.refreshTimers)clearTimeout(t);this.refreshTimers=[];}
  disposePdfComponent(){
    if(this.pdfComponent){try{this.plugin.removeChild(this.pdfComponent);}catch(_){this.pdfComponent.unload?.();}this.pdfComponent=null;}
  }
  unlock(){
    this.clearRepaintTimers();
    this.lockedPath='';
    this.isInPopup=false;this.hoveringLabel=false;
    this.adapter.renderer.highlightNode=null;
    // A stale PIXI hit-test must not immediately restore the old hover state.
    this.adapter.renderer.mouseX=-1e9;
    this.adapter.renderer.mouseY=-1e9;
    this.setFocus('');
    this.adapter.repaint();
  }
  handlePointerDown(e){
    if(e.button!==0 || e.target?.closest?.('.ew-native-pdf,.ew-native-edge-label')){this.down=null;return;}
    const bounds=this.adapter.getContainer().getBoundingClientRect();
    const x=e.clientX-bounds.left,y=e.clientY-bounds.top;
    this.down={x,y,button:e.button,nearNode:this.adapter.isNearNode(x,y)};
  }
  handlePointerUp(e){
    const down=this.down;this.down=null;
    if(!down || !this.lockedPath || e.button!==0 || e.target?.closest?.('.ew-native-pdf,.ew-native-edge-label'))return;
    const bounds=this.adapter.getContainer().getBoundingClientRect();
    const x=e.clientX-bounds.left,y=e.clientY-bounds.top;
    // Do not interpret pan/drag or a nearby node click as an empty-space click.
    if(Math.hypot(x-down.x,y-down.y)>7 || down.nearNode || this.adapter.isNearNode(x,y))return;
    this.unlock();
  }
  tick(){
    if(this.destroyed)return;
    const host=this.adapter.getContainer();
    if(!host?.isConnected){this.setFocus('');}
    else {
      const hover=this.adapter.getNativeHoveredNode();
      let wanted='';
      if(this.lockedPath)wanted=this.lockedPath;
      else if(this.editing||this.isInPopup||this.hoveringLabel)wanted=this.focusPath;
      else if(this.pointerInGraph&&hover&&isFileGraphNode(hover.id))wanted=hover.id;
      if(wanted&&!this.plugin.isScopedPath(wanted))wanted='';
      if(wanted!==this.focusPath)this.setFocus(wanted);
      if(this.focusPath){this.updatePositions();this.placePdf();}
    }
    this.rafId=requestAnimationFrame(()=>this.tick());
  }
  setFocus(path){
    if(path===this.focusPath)return;
    if(this.editing)this.cancelEdit();
    this.focusPath=path;
    this.seq++;
    this.renderEdgeLabels();
    this.updatePdf(path);
  }
  nativeFocusLinks(){
    const focus=this.focusPath;
    return focus?this.adapter.getLinks().filter(link=>{
      const a=typeof link.source==='string'?link.source:link.source?.id;
      const b=typeof link.target==='string'?link.target:link.target?.id;
      return a===focus||b===focus;
    }):[];
  }
  renderEdgeLabels(){
    this.labelLayer?.replaceChildren();this.labels=[];
    if(!this.focusPath||!this.plugin.model)return;
    const m=this.plugin.model;
    const byPath=new Map(m.nodes.map(n=>[n.path,n]));
    for(const link of this.nativeFocusLinks()){
      const a=typeof link.source==='string'?link.source:link.source?.id;
      const b=typeof link.target==='string'?link.target:link.target?.id;
      const refs=matchNativeRelation(a,b,m,this.plugin.settings.overviewPath);
      if(!refs.length)continue;
      // Native graph might collapse duplicate relations to one physical line.
      // Display the first without claiming the others are identical.
      const {relation,proxy}=refs[0];
      const viewpoint=viewpointForNativeRelation(this.focusPath,relation,byPath,this.plugin.settings.overviewPath);
      if(!viewpoint)continue;
      const summary=directedSummary(relation,viewpoint);
      if(!summary)continue;
      const btn=ewEl('button','ew-native-edge-label',this.labelLayer,shorten(summary,this.plugin.settings.labelMaxChars));
      btn.type='button';btn.title=summary;
      btn.setAttribute('aria-label',`编辑 ${relation.id} 关系：${summary}`);
      btn.setAttribute('data-relation-id',relation.id);
      btn.addEventListener('pointerenter',()=>{this.hoveringLabel=true;});
      btn.addEventListener('pointerleave',()=>{this.hoveringLabel=false;});
      btn.addEventListener('pointerdown',ev=>ev.stopPropagation());
      btn.addEventListener('click',ev=>{ev.stopPropagation();this.startEdit({button:btn,relation,viewpoint,summary});});
      this.labels.push({element:btn,link,relation,viewpoint,proxy});
    }
  }
  updatePositions(){
    const host=this.adapter.getContainer();
    const bounds=host?.getBoundingClientRect();
    if(!bounds)return;
    for(const label of this.labels){
      const source=typeof label.link.source==='string'?this.adapter.getNode(label.link.source):label.link.source;
      const target=typeof label.link.target==='string'?this.adapter.getNode(label.link.target):label.link.target;
      const coords=labelPosition(this.adapter.screenPosition(source),this.adapter.screenPosition(target));
      if(!coords) {label.element.hidden=true;continue;}
      const visible=coords.x>-5&&coords.x<bounds.width+5&&coords.y>-5&&coords.y<bounds.height+5;
      label.element.hidden=!visible;
      label.element.style.left=`${coords.x}px`;
      label.element.style.top=`${coords.y}px`;
      label.element.style.setProperty('--ew-rotation',`${coords.angle}rad`);
      if(this.editing?.button===label.element){
        this.editing.input.style.left=`${coords.x}px`;
        this.editing.input.style.top=`${coords.y}px`;
      }
    }
  }
  startEdit(item){
    if(!this.lockedPath){
      // Editing needs a stable focus; clicking a label locks its existing node.
      this.lock(this.focusPath);
    }
    if(this.editing)return;
    const button=item.button;
    const input=ewEl('input','ew-native-edge-editor',null);
    input.type='text';input.maxLength=400;input.value=item.summary;
    input.setAttribute('aria-label','修改关系说明，回车保存，Esc 取消');
    button.replaceWith(input);
    input.style.cssText=button.style.cssText;
    input.style.setProperty('--ew-rotation','0rad');
    this.editing={...item,input,button, saving:false};
    input.addEventListener('pointerdown',e=>e.stopPropagation());
    input.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.cancelEdit();}
      if(e.key==='Enter'){e.preventDefault();e.stopPropagation();void this.commitEdit();}
    });
    input.addEventListener('blur',()=>{if(!this.editing?.saving)this.cancelEdit();});
    input.focus();input.select();
  }
  cancelEdit(){
    if(!this.editing)return;
    const e=this.editing;
    this.editing=null;
    e.input?.replaceWith(e.button);
  }
  async commitEdit(){
    const e=this.editing;
    if(!e||e.saving)return;
    e.saving=true;
    try {
      const next=validateSummary(e.input.value);
      if(next===e.summary){this.cancelEdit();return;}
      const storage=e.relation.storage;
      if(!storage?.note || !this.plugin.isScopedPath(storage.note))throw new Error('来源路径超出授权范围');
      const file=this.plugin.app.vault.getAbstractFileByPath(storage.note);
      if(!file||file.extension!=='md')throw new Error('原关系笔记不存在');
      if(e.relation.kind==='overview'&&storage.note!==this.plugin.settings.overviewPath)
        throw new Error('概览路径和配置不一致');
      const vault=this.plugin.app.vault;
      // Vault.process provides local serialized writes. Source-line or YAML guards
      // reject stale edits before modifying an asynchronously synchronized file.
      await vault.process(file,contents=>{
        if(e.relation.kind==='overview')return patchOverviewSummary(contents,e.relation,e.viewpoint,next);
        if(e.relation.kind==='typed')return patchTypedSummary(contents,e.relation,e.viewpoint,next,parseYaml);
        throw new Error('普通双链没有可写入的学术语义');
      });
      this.editing=null;
      e.input.replaceWith(e.button);
      new Notice('EvidenceWeave：关系已写回笔记，标记为待复核');
      await this.plugin.refreshModel();
    }catch(error){
      new Notice(`EvidenceWeave：未保存，${error.message||String(error)}`);
      this.editing=null;
      e.input?.replaceWith(e.button);
    }
  }
  async updatePdf(path){
    this.pdfKey='';
    this.disposePdfComponent();
    if(!this.popup)return;
    this.popup.hidden=true;
    this.popup.replaceChildren();
    if(!path)return;
    const node=nodeFromGraphPath(path,this.plugin.model||{nodes:[]});
    if(!node||node.kind!=='paper'&&node.kind!=='center')return;
    const seq=++this.seq;
    try {
      const file=node.file;
      const text=await this.plugin.app.vault.cachedRead(file);
      if(this.destroyed||seq!==this.seq||this.focusPath!==path)return;
      let local=null;
      if(node.pdfPath){
        const resolved=this.plugin.app.metadataCache.getFirstLinkpathDest?.(node.pdfPath,node.path)
            ||this.plugin.app.vault.getAbstractFileByPath(node.pdfPath);
        if(ewIsPdfFile(resolved))local=resolved;
      }
      const remote=discoverPdfUrl(text,{pdf_url:node.pdfUrl});
      if(!local&&!remote)return; // No PDF? NO FLOATING RECTANGLE.
      this.pdfKey=path;
      this.popup.hidden=false;
      const head=ewEl('header','ew-native-pdf-header',this.popup);
      ewEl('div','ew-native-pdf-name',head,shorten(node.title,54));
      const actions=ewEl('div','ew-native-pdf-actions',head);
      const body=ewEl('div','ew-native-pdf-body',this.popup);
      let scale=1;
      const makeBtn=(txt,title,fn)=>{
        const el=ewEl('button','ew-native-pdf-action',actions,txt);
        el.type='button';el.title=title;el.addEventListener('click',fn);return el;
      };
      makeBtn('−','缩小 PDF',()=>{scale=Math.max(.75,scale-.15);body.style.zoom=String(scale);});
      makeBtn('＋','放大 PDF',()=>{scale=Math.min(2.5,scale+.15);body.style.zoom=String(scale);});
      makeBtn('×','关闭预览',()=>{this.popup.hidden=true;this.pdfKey='';});
      if(local){
        // Native Markdown PDF embed; keeps Obsidian's own PDF scrolling/zoom toolbar.
        const component=new Component();
        this.plugin.addChild(component);this.pdfComponent=component;
        await MarkdownRenderer.render(this.plugin.app,`![[${local.path}]]`,body,node.path,component);
      }else {
        const frame=ewEl('iframe','ew-native-pdf-frame',body);
        frame.src=remote;
        frame.title=`论文 PDF：${node.title}`;
        frame.setAttribute('loading','lazy');
        frame.setAttribute('referrerpolicy','no-referrer');
                frame.setAttribute('aria-label','PDF 外部文档预览');
        makeBtn('↗','在浏览器打开 PDF',()=>window.open(remote,'_blank','noopener,noreferrer'));
      }
      this.placePdf();
    }catch(err){
      if(seq!==this.seq)return;
      console.warn('[EvidenceWeave] PDF preview skipped',err);
      this.popup.hidden=true;
      this.pdfKey='';
    }
  }
  placePdf(){
    if(!this.popup||this.popup.hidden||!this.focusPath||this.pdfKey!==this.focusPath)return;
    const graphNode=this.adapter.getNode(this.focusPath);
    const point=this.adapter.screenPosition(graphNode);
    const host=this.adapter.getContainer();
    const rect=host?.getBoundingClientRect();
    if(!rect||!point)return;
    const box=placePdfByNode(point,{width:rect.width,height:rect.height},this.plugin.settings.pdfWidth,this.plugin.settings.pdfHeight);
    if(!box){this.popup.hidden=true;return;}
    this.popup.style.left=`${box.x}px`;
    this.popup.style.top=`${box.y}px`;
    this.popup.style.width=`${box.width}px`;
    this.popup.style.height=`${box.height}px`;
    this.popup.dataset.side=box.side;
  }
  onModelUpdated(){
    this.renderEdgeLabels();
    if(this.lockedPath&&!this.plugin.isScopedPath(this.lockedPath))this.unlock();
    else if(this.focusPath){this.seq++;this.updatePdf(this.focusPath);}
  }
}
