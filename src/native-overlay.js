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

/** Only annotate the ACTUAL scholarly pair. M00→paper navigation is not
 * automatically a C00→paper research relationship. */
function matchNativeRelation(sourcePath,targetPath,model,_overviewPath) {
  const nodes=new Map(model.nodes.map(n=>[n.path,n]));
  const a=nodes.get(sourcePath), b=nodes.get(targetPath);
  if(!a||!b)return [];
  return model.edges.filter(r=>r.kind!=='wikilink' &&
    ewPair(r.source,r.target)===ewPair(a.id,b.id)).map(relation=>({relation,proxy:false}));
}
function viewpointForNativeRelation(focusPath,relation,nodeByPath,_overviewPath) {
  const n=nodeByPath.get(focusPath);
  return n&&(n.id===relation.source||n.id===relation.target)?n.id:'';
}
function nodeFromGraphPath(path,model){return model.nodes.find(n=>n.path===path)||null;}
function isFileGraphNode(id){return typeof id==='string' && id.endsWith('.md');}
function eventMayCommit(e){return e.key==='Enter' && !e.isComposing && e.keyCode!==229 && !e.repeat;}

class NativeGraphBinding {
  constructor(plugin,leaf,renderer){
    this.plugin=plugin;this.leaf=leaf;this.adapter=new NativeGraphAdapter(renderer);
    this.lockedPath='';this.focusPath='';this.labels=[];
    this.destroyed=false;this.editing=null;this.pdfKey='';this.pdfSignature='';
    this.seq=0;this.pdfTimer=null;this.rafId=null;this.lastFrame=0;
    this.isInPopup=false;this.hoveringLabel=false;this.pointerInGraph=false;
    this.hoverGraceUntil=0;this.hoverSuppressed=false;this.lastPointer=null;
    this.pdfComponent=null;this.pdfFrame=null;this.pdfClosedForPath='';
    this.pdfObjectUrl=null;this.pdfResolved=null;this.pdfNodeOffset=null;this.pdfCheckSeq=0;
    this.drag=null;this.down=null;this.pdfWorld=null;this.pdfInitialScale=1;
    this.pdfBaseSize={width:plugin.settings.pdfWidth,height:plugin.settings.pdfHeight};
    this.drafts=new Map();this.lastZoom=1;this.lastHoverAt=0;this.labelsBaseScale=0;
    this.onDown=e=>this.handlePointerDown(e);
    this.onUp=e=>this.handlePointerUp(e);
    this.onPointerMove=e=>this.handleGraphPointerMove(e);
    this.onEnter=()=>{this.pointerInGraph=true;};
    this.onLeave=e=>{if(!this.popup?.contains(e.relatedTarget))this.pointerInGraph=false;};
  }
  camera(){const r=this.adapter.renderer;return {scale:r.scale,panX:r.panX,panY:r.panY,dpr:window.devicePixelRatio||1};}
  attach(){
    const host=this.adapter.getContainer();
    if(!host||this.destroyed)return;
    this.previousInlinePosition=host.style.position;
    if(getComputedStyle(host).position==='static')host.style.position='relative';
    this.overlay=ewEl('div','ew-native-overlay',host);
    this.overlay.setAttribute('aria-label','EvidenceWeave：原生图谱注释');
    this.labelLayer=ewEl('div','ew-native-label-layer',this.overlay);
    this.popup=ewEl('section','ew-native-pdf',this.overlay);
    this.popup.hidden=true;this.popup.setAttribute('aria-label','论文 PDF 阅读区域');
    this.popup.addEventListener('pointerenter',()=>{this.isInPopup=true;this.hoverGraceUntil=Date.now()+450;});
    this.popup.addEventListener('pointerleave',()=>{this.isInPopup=false;this.hoverGraceUntil=Date.now()+350;});
    host.addEventListener('pointerdown',this.onDown,true);
    host.addEventListener('pointerup',this.onUp,true);
    host.addEventListener('pointermove',this.onPointerMove,true);
    host.addEventListener('pointerenter',this.onEnter);
    host.addEventListener('pointerleave',this.onLeave);
    this.adapter.mount((event,id,type)=>this.onNodeClick(event,id,type),()=>{
      const pinned=this.lockedPath || ((this.isInPopup||this.drag||this.hoveringLabel||this.editing||Date.now()<this.hoverGraceUntil)?this.focusPath:'');
      return pinned?this.adapter.getNode(pinned):null;
    });
    // All native mouse gestures and the original graph simulation are left
    // intact; only Overlay DOM elements accept pointer events.
    this.rafId=requestAnimationFrame(now=>this.tick(now));
  }
  detach(){
    if(this.destroyed)return;
    this.destroyed=true;
    cancelAnimationFrame(this.rafId);clearTimeout(this.pdfTimer);
    this.disposePdfComponent();this.releasePdfHandlers();
    const host=this.adapter.getContainer();
    host?.removeEventListener('pointerdown',this.onDown,true);
    host?.removeEventListener('pointerup',this.onUp,true);
    host?.removeEventListener('pointermove',this.onPointerMove,true);
    host?.removeEventListener('pointerenter',this.onEnter);
    host?.removeEventListener('pointerleave',this.onLeave);
    if(host&&this.previousInlinePosition!==undefined)host.style.position=this.previousInlinePosition;
    this.adapter.unmount();this.overlay?.remove();this.overlay=null;
  }
  onNodeClick(event,id,_type){
    if(!isFileGraphNode(id)||!this.plugin.isScopedPath(id))return false;
    if(event?.metaKey||event?.ctrlKey||event?.shiftKey||event?.altKey)return false;
    if(event&&event.button!==undefined&&event.button!==0)return false;
    // Obsidian invokes its click handler, not the node's drag handler.
    this.lock(id);return true;
  }
  lock(path){
    if(!isFileGraphNode(path))return;
    this.lockedPath=path;this.pointerInGraph=true;this.hoverSuppressed=false;
    this.setFocus(path);
    // Freeze only PDF's WORLD position, never native graph positions.
    this.adapter.repaint();
  }
  unlock(){
    this.lockedPath='';this.isInPopup=false;this.hoveringLabel=false;
    this.hoverGraceUntil=0;this.hoverSuppressed=true;
    this.adapter.renderer.highlightNode=null;
    this.setFocus('');this.adapter.repaint();
  }
  handleGraphPointerMove(e){
    const p={x:e.clientX,y:e.clientY};
    if(this.hoverSuppressed&&this.lastPointer&&Math.hypot(p.x-this.lastPointer.x,p.y-this.lastPointer.y)>3){
      this.hoverSuppressed=false;
    }
    this.lastPointer=p;
  }
  handlePointerDown(e){
    if(e.button!==0||e.target?.closest?.('.ew-native-pdf,.ew-native-edge-label,.ew-native-edge-editor')){
      this.down=null;return;
    }
    const b=this.adapter.getContainer().getBoundingClientRect();
    const x=e.clientX-b.left,y=e.clientY-b.top;
    this.down={x,y,nearNode:this.adapter.isNearNode(x,y)};
  }
  handlePointerUp(e){
    const down=this.down;this.down=null;
    if(!down||!this.lockedPath||e.button!==0||e.target?.closest?.('.ew-native-pdf,.ew-native-edge-label,.ew-native-edge-editor'))return;
    const b=this.adapter.getContainer().getBoundingClientRect();
    const x=e.clientX-b.left,y=e.clientY-b.top;
    if(Math.hypot(x-down.x,y-down.y)>7||down.nearNode||this.adapter.isNearNode(x,y))return;
    this.unlock();
  }
  tick(now){
    if(this.destroyed)return;
    this.rafId=requestAnimationFrame(time=>this.tick(time));
    // At most ~30fps for HTML. Native Graph's own rendering/physics is NEVER
    // gated, paused, or scheduled by our plugin.
    if(now-this.lastFrame<30)return;
    this.lastFrame=now;
    const host=this.adapter.getContainer();
    if(!host?.isConnected){this.setFocus('');return;}
    let wanted='';
    if(this.lockedPath)wanted=this.lockedPath;
    else if(this.editing||this.drag||this.isInPopup||this.hoveringLabel||Date.now()<this.hoverGraceUntil)wanted=this.focusPath;
    else if(!this.hoverSuppressed&&this.pointerInGraph){
      const hover=this.adapter.getNativeHoveredNode();
      if(hover&&isFileGraphNode(hover.id)){wanted=hover.id;this.lastHoverAt=Date.now();}
      else if(this.focusPath&&Date.now()-this.lastHoverAt<420)wanted=this.focusPath;
    }
    if(wanted&&!this.plugin.isScopedPath(wanted))wanted='';
    if(wanted!==this.focusPath)this.setFocus(wanted);
    if(this.focusPath){this.updatePositions();this.placePdf();}
  }
  setFocus(path){
    if(path===this.focusPath)return;
    if(this.editing){this.saveDraft();this.cancelEdit();}
    this.focusPath=path;this.seq++;this.labelsBaseScale=this.adapter.renderer.scale;
    if(!path)this.pdfClosedForPath='';
    clearTimeout(this.pdfTimer);
    this.renderEdgeLabels();
    if(!path){this.hidePdf();return;}
    // Delay heavy PDF mounting until the user actually hovers for a moment;
    // prevents rapid pointer scanning from constantly creating Chromium PDFs.
    if(this.pdfKey===path){this.popup.hidden=this.pdfClosedForPath===path;return;}
    this.hidePdf();
    this.pdfTimer=setTimeout(()=>void this.updatePdf(path),180);
  }
  nativeFocusLinks(){
    const focus=this.focusPath;
    return focus?this.adapter.getLinks().filter(l=>{
      const a=typeof l.source==='string'?l.source:l.source?.id;
      const b=typeof l.target==='string'?l.target:l.target?.id;
      return a===focus||b===focus;
    }):[];
  }
  renderEdgeLabels(){
    if(this.editing)return;
    this.hoveringLabel=false;this.labelLayer?.replaceChildren();this.labels=[];
    if(!this.focusPath||!this.plugin.model)return;
    const model=this.plugin.model,byPath=new Map(model.nodes.map(n=>[n.path,n]));
    for(const link of this.nativeFocusLinks()){
      const a=typeof link.source==='string'?link.source:link.source?.id;
      const b=typeof link.target==='string'?link.target:link.target?.id;
      const matches=matchNativeRelation(a,b,model,this.plugin.settings.overviewPath);
      if(!matches.length)continue;
      const {relation}=matches[0];
      const viewpoint=viewpointForNativeRelation(this.focusPath,relation,byPath,this.plugin.settings.overviewPath);
      if(!viewpoint)continue;
      const label=shortLabelFor(relation,viewpoint);
      const waiting=!label;
      const el=ewEl('button','ew-native-edge-label'+(waiting?' ew-label-empty':''),this.labelLayer,label||'＋短句');
      el.type='button';el.title=label||'点击填写这条边的方向性短标签，不修改原文证据';
      if(label)el.title+=`\n原文关系：${directedSummary(relation,viewpoint)}`;
      el.setAttribute('aria-label',`编辑关系短标签 ${relation.id}`);
      el.dataset.relationId=relation.id;
      el.dataset.review=relation.labelStatus||'unverified';
      el.addEventListener('pointerenter',()=>{this.hoveringLabel=true;this.hoverGraceUntil=Date.now()+350;});
      el.addEventListener('pointerleave',()=>{this.hoveringLabel=false;this.hoverGraceUntil=Date.now()+250;});
      el.addEventListener('pointerdown',ev=>ev.stopPropagation());
      el.addEventListener('click',ev=>{ev.stopPropagation();this.startEdit({button:el,relation,viewpoint,label});});
      this.labels.push({element:el,link,relation,viewpoint,label});
    }
  }
  updatePositions(){
    if(!this.labels.length)return;
    const host=this.adapter.getContainer(),rect=host?.getBoundingClientRect();
    if(!rect)return;
    const zoom=graphScaleFactor(this.adapter.renderer,this.labelsBaseScale||this.adapter.renderer.scale);
    const candidates=[];
    const block=this.popup&&!this.popup.hidden?this.popup.getBoundingClientRect():null;
    const popupRect=block?{left:block.left-rect.left,right:block.right-rect.left,top:block.top-rect.top,bottom:block.bottom-rect.top}:null;
    for(let i=0;i<this.labels.length;i++){
      const l=this.labels[i];
      const a=typeof l.link.source==='string'?this.adapter.getNode(l.link.source):l.link.source;
      const b=typeof l.link.target==='string'?this.adapter.getNode(l.link.target):l.link.target;
      const pa=this.adapter.screenPosition(a),pb=this.adapter.screenPosition(b);
      if(!pa||!pb)continue;
      const characters=(l.label||'＋短句').length;
      candidates.push({id:i,a:pa,b:pb,width:Math.min(200,Math.max(29,characters*12+10)),height:21,zoom});
    }
    const placements=avoidLabelCollisions(candidates,popupRect);
    const positions=new Map(placements.map(p=>[p.id,p]));
    for(let i=0;i<this.labels.length;i++){
      const l=this.labels[i],p=positions.get(i);
      // Keep the editor at its ORIGINAL screen position while typing, even
      // when native graph physics animates the link underneath.
      const isEditing=this.editing?.button===l.element;
      l.element.hidden=!!isEditing||!p||p.x<0||p.y<0||p.x>rect.width||p.y>rect.height;
      if(p){
        l.element.style.left=`${p.x}px`;l.element.style.top=`${p.y}px`;
        l.element.style.setProperty('--ew-rotation',`${p.angle}rad`);
        l.element.style.setProperty('--ew-label-scale',String(zoom));
      }
    }
  }
  draftKey(item){return item.relation.id+'|'+item.viewpoint;}
  startEdit(item){
    if(this.editing)return;
    if(!this.lockedPath)this.lock(this.focusPath);
    const button=item.button;
    const input=ewEl('input','ew-native-edge-editor',this.labelLayer);
    input.type='text';input.maxLength=70;
    input.value=this.drafts.get(this.draftKey(item))??item.label;
    input.setAttribute('aria-label','关系短句：回车保存，Esc 取消');
    input.style.left=button.style.left;input.style.top=button.style.top;
    const edit={...item,input,saving:false,composing:false};this.editing=edit;
    button.hidden=true;
    input.addEventListener('pointerdown',e=>e.stopPropagation());
    input.addEventListener('compositionstart',()=>{edit.composing=true;});
    input.addEventListener('compositionend',()=>{edit.composing=false;});
    input.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&!e.isComposing&&!edit.composing){e.preventDefault();e.stopPropagation();this.drafts.delete(this.draftKey(edit));this.cancelEdit();}
      else if(eventMayCommit(e)&&!edit.composing){e.preventDefault();e.stopPropagation();void this.commitEdit();}
    });
    input.addEventListener('blur',()=>{if(this.editing===edit&&!edit.saving){this.saveDraft();this.cancelEdit();}});
    input.focus();input.select();
  }
  saveDraft(){
    const e=this.editing;
    if(e&&!e.saving&&e.input?.value?.trim()!==e.label)this.drafts.set(this.draftKey(e),e.input.value);
  }
  cancelEdit(){
    const e=this.editing;if(!e)return;
    this.editing=null;e.input?.remove();e.button.hidden=false;
  }
  async commitEdit(){
    const e=this.editing;if(!e||e.saving)return;
    e.saving=true;
    try{
      const next=validateShortLabel(e.input.value);
      if(next===e.label){this.drafts.delete(this.draftKey(e));this.cancelEdit();return;}
      const s=e.relation.storage;
      if(!s?.note||!this.plugin.isScopedPath(s.note))throw Error('找不到允许写入的关系源文件');
      const file=this.plugin.app.vault.getAbstractFileByPath(s.note);
      if(!file||file.extension!=='md')throw Error('关系源文件已不存在');
      if(e.relation.kind==='overview'&&s.note!==this.plugin.settings.overviewPath)throw Error('关系总览路径有变化');
      await this.plugin.app.vault.process(file,current=>{
        if(e.relation.kind==='overview')return patchOverviewLabel(current,e.relation,e.viewpoint,next);
        if(e.relation.kind==='typed')return patchTypedLabel(current,e.relation,e.viewpoint,next,parseYaml);
        throw Error('普通双链没有可写的关系短句');
      });
      this.drafts.delete(this.draftKey(e));this.cancelEdit();
      new Notice('EvidenceWeave：短句已写入原笔记；原文证据未改变，短句待复核');
      await this.plugin.refreshModel();
    }catch(err){
      e.saving=false;
      this.drafts.set(this.draftKey(e),e.input.value);
      new Notice(`EvidenceWeave：未保存，草稿保留。${err.message||String(err)}`);
      if(this.editing===e){e.input.focus();}
    }
  }
  disposePdfComponent(){
    if(this.pdfComponent){try{this.plugin.removeChild(this.pdfComponent);}catch(_){this.pdfComponent.unload?.();}this.pdfComponent=null;}
  }
  hidePdf(){
    this.pdfKey='';this.pdfSignature='';this.pdfWorld=null;this.pdfResolved=null;this.pdfNodeOffset=null;this.isInPopup=false;
    if(this.pdfObjectUrl){URL.revokeObjectURL(this.pdfObjectUrl);this.pdfObjectUrl=null;}
    this.disposePdfComponent();this.releasePdfHandlers();
    if(this.popup){this.popup.hidden=true;this.popup.replaceChildren();}
  }
  releasePdfHandlers(){
    if(this.drag?.element){
      const d=this.drag;
      try{d.element.releasePointerCapture(d.pointerId);}catch(_){}
      if(d.move)d.element.removeEventListener('pointermove',d.move);
      if(d.end){d.element.removeEventListener('pointerup',d.end);d.element.removeEventListener('pointercancel',d.end);}
    }
    this.drag=null;
  }
  pdfSignatureFor(node){return [node?.path,node?.pdfPath,node?.pdfUrl].join('|');}
  async updatePdf(path){
    if(this.destroyed||this.focusPath!==path||this.pdfClosedForPath===path)return;
    const node=nodeFromGraphPath(path,this.plugin.model||{nodes:[]});
    if(!node||!['paper','center'].includes(node.kind))return;
    if(this.pdfKey===path&&this.pdfSignature===this.pdfSignatureFor(node))return;
    const seq=++this.seq;
    let contents;
    try{contents=await this.plugin.app.vault.cachedRead(node.file);}catch(_){return;}
    if(this.destroyed||this.focusPath!==path||seq!==this.seq)return;
    let local=null;
    if(node.pdfPath){
      const res=this.plugin.app.metadataCache.getFirstLinkpathDest?.(node.pdfPath,node.path)||
        this.plugin.app.vault.getAbstractFileByPath(node.pdfPath);
      if(ewIsPdfFile(res))local=res;
    }
    const remote=discoverPdfUrl(contents,{pdf_url:node.pdfUrl});
    if(!local&&!remote)return;
    this.hidePdf();
    this.pdfKey=path;this.pdfSignature=this.pdfSignatureFor(node);
    this.pdfResolved=local?{kind:'local',path:local.path}:{kind:'remote',url:remote};
    this.pdfClosedForPath='';
    this.pdfBaseSize={width:this.plugin.settings.pdfWidth,height:this.plugin.settings.pdfHeight};
    const graphNode=this.adapter.getNode(path);
    const point=this.adapter.screenPosition(graphNode);
    const rect=this.adapter.getContainer().getBoundingClientRect();
    const initial=pdfOriginForNode(point,{width:rect.width,height:rect.height},this.pdfBaseSize.width,this.pdfBaseSize.height);
    if(!initial){this.hidePdf();return;}
    const cam=this.camera();
    this.pdfInitialScale=cam.scale;
    this.pdfWorld=screenToWorld({x:initial.x,y:initial.y},cam);
    this.pdfNodeOffset=graphNode?{x:this.pdfWorld.x-graphNode.x,y:this.pdfWorld.y-graphNode.y}:null;
    this.popup.hidden=false;
    const head=ewEl('header','ew-native-pdf-header',this.popup);
    head.title='按住标题栏拖动 PDF 窗口';
    // The header is the grab handle. Buttons retain their own click actions;
    // dragging never touches Obsidian's native Graph pan/node physics.
    head.addEventListener('pointerdown',ev=>this.beginMove(ev));
    ewEl('div','ew-native-pdf-name',head,node.title).title=node.title;
    const actions=ewEl('div','ew-native-pdf-actions',head);
    const body=ewEl('div','ew-native-pdf-body',this.popup);
    const button=(label,title,fn)=>{
      const b=ewEl('button','ew-native-pdf-action',actions,label);
      b.type='button';b.title=title;b.addEventListener('click',ev=>{ev.stopPropagation();fn();});return b;
    };
    // Removing an outer PDF +/- toolbar avoids two conflicting zoom layers.
    button('↗','在外部打开完整 PDF',()=>this.openFullPdf(local,remote));
    if(!local&&remote)button('↻','尝试将整份远程 PDF 加载到内存后重读，最多 30 MB',()=>void this.cacheRemotePdf(remote,path,status,body));
    button('×','关闭当前 PDF',()=>{this.pdfClosedForPath=path;this.hidePdf();});
    const status=ewEl('div','ew-native-pdf-status',this.popup);
    status.textContent=local?'本地 PDF · Obsidian 阅读器':'远程 PDF · 若出版社限制内嵌，请使用 ↗ 完整阅读';
    // Four unobtrusive draggable corner handles; the entire panel remains
    // inside the same graph-world camera transform (not a fixed sidebar).
    for(const corner of ['nw','ne','sw','se']){
      const handle=ewEl('div','ew-native-resize ew-resize-'+corner,this.popup);
      handle.title='拖动角落调整 PDF 阅读窗口大小';
      handle.dataset.corner=corner;
      handle.addEventListener('pointerdown',ev=>this.beginDrag(ev,corner));
    }
    this.popup.addEventListener('pointerdown',ev=>ev.stopPropagation());
    this.popup.addEventListener('pointerup',ev=>ev.stopPropagation());
    try{
      if(local){
        const component=new Component();this.plugin.addChild(component);this.pdfComponent=component;
        await MarkdownRenderer.render(this.plugin.app,`![[${local.path}]]`,body,node.path,component);
      }else{
        // Let Chromium handle PDF pagination internally with ONE scroll area.
        // Crucially do not use loading=lazy or style.zoom on the iframe: both
        // can leave later PDF pages blank when resized/translated.
        const iframe=ewEl('iframe','ew-native-pdf-frame',body);
        iframe.src=remote;
        iframe.title=`论文 PDF：${node.title}`;
        iframe.setAttribute('loading','eager');iframe.setAttribute('referrerpolicy','no-referrer');
        this.pdfFrame=iframe;
        iframe.addEventListener('load',()=>{if(this.pdfKey===path&&!this.pdfObjectUrl)status.textContent='远程 PDF · 滚动由 PDF 阅读器负责，遇到缺页请用 ↗';});
      }
      if(this.pdfKey===path)this.placePdf();
    }catch(err){
      console.warn('[EvidenceWeave] PDF embed unavailable',err);
      if(this.pdfKey===path){
        body.replaceChildren();
        ewEl('p','ew-native-pdf-error',body,'无法内嵌此 PDF。请点击 ↗ 在浏览器中完整阅读。');
      }
    }
  }
  async cacheRemotePdf(remote,path,status,body){
    if(this.pdfKey!==path||!this.pdfFrame)return;
    if(typeof requestUrl!=='function'){
      new Notice('当前 Obsidian 不支持完整下载，建议使用 ↗ 外部阅读');return;
    }
    status.textContent='正在完整载入远程 PDF（最多 30 MB），可继续浏览图谱…';
    try{
      const response=await requestUrl({url:remote,method:'GET'});
      const bytes=response.arrayBuffer;
      const length=bytes?.byteLength||0;
      if(!length||length>30*1024*1024)throw Error('PDF 为空或超过 30 MB 限额');
      const header=new TextDecoder('ascii').decode(new Uint8Array(bytes,0,Math.min(8,length)));
      if(!header.startsWith('%PDF-'))throw Error('远端返回的不是 PDF 文件');
      if(this.destroyed||this.pdfKey!==path)return;
      const blob=new Blob([bytes],{type:'application/pdf'});
      const objectUrl=URL.createObjectURL(blob);
      if(this.pdfObjectUrl)URL.revokeObjectURL(this.pdfObjectUrl);
      this.pdfObjectUrl=objectUrl;
      this.pdfFrame.src=objectUrl;
      status.textContent=`已完整下载 ${(length/1024/1024).toFixed(1)} MB · 可尝试滚动至最后一页`;
    }catch(err){
      if(this.pdfKey===path)status.textContent='完整下载未成功 · 可点击 ↗ 在浏览器阅读';
      new Notice(`EvidenceWeave：完整 PDF 载入失败：${err.message||String(err)}`);
    }
  }
  openFullPdf(local,remote){
    if(local){const path=this.plugin.app.vault.getResourcePath(local);window.open(path,'_blank','noopener,noreferrer');}
    else if(remote)window.open(remote,'_blank','noopener,noreferrer');
  }
  beginMove(e){
    if(e.target?.closest?.('.ew-native-pdf-actions,button,a,input,[data-no-drag]'))return;
    this.beginDrag(e,null);
  }
  beginDrag(e,corner){
    if(e.button!==0||!this.pdfWorld||this.drag)return;
    e.preventDefault();e.stopPropagation();
    const elem=e.currentTarget;
    this.drag={pointerId:e.pointerId,element:elem,corner,mode:corner?'resize':'move',
      startX:e.clientX,startY:e.clientY,
      initial:{x:this.pdfWorld.x,y:this.pdfWorld.y,width:this.pdfBaseSize.width,height:this.pdfBaseSize.height},
      zoom:graphScaleFactor(this.adapter.renderer,this.pdfInitialScale),camera:this.camera()};
    this.isInPopup=true;
    elem.setPointerCapture?.(e.pointerId);
    const move=ev=>corner?this.dragResize(ev):this.dragMove(ev);
    const end=ev=>{
      if(this.drag?.pointerId===ev.pointerId){
        const wasResize=this.drag.mode==='resize';
        this.releasePdfHandlers();
        const node=this.adapter.getNode(this.focusPath);
        if(node&&this.pdfWorld)this.pdfNodeOffset={x:this.pdfWorld.x-node.x,y:this.pdfWorld.y-node.y};
        if(wasResize)this.persistSize();
        this.hoverGraceUntil=Date.now()+350;
      }
    };
    this.drag.move=move;this.drag.end=end;
    elem.addEventListener('pointermove',move);
    elem.addEventListener('pointerup',end);
    elem.addEventListener('pointercancel',end);
  }
  dragMove(e){
    const d=this.drag;
    if(!d||d.mode!=='move'||d.pointerId!==e.pointerId)return;
    e.preventDefault();e.stopPropagation();
    const next=movedWorldPanel(d.initial,{x:e.clientX-d.startX,y:e.clientY-d.startY},d.camera);
    this.pdfWorld={x:next.x,y:next.y};
    this.placePdf();
  }
  dragResize(e){
    const d=this.drag;
    if(!d||d.pointerId!==e.pointerId)return;
    e.preventDefault();e.stopPropagation();
    const next=resizedWorldPanel(d.initial,{x:e.clientX-d.startX,y:e.clientY-d.startY,corner:d.corner},d.camera,d.zoom);
    this.pdfBaseSize.width=next.width;this.pdfBaseSize.height=next.height;
    this.pdfWorld={x:next.x,y:next.y};
    this.placePdf();
  }
  persistSize(){
    if(!this.plugin.settings.rememberPdfSize)return;
    this.plugin.settings.pdfWidth=Math.round(this.pdfBaseSize.width);
    this.plugin.settings.pdfHeight=Math.round(this.pdfBaseSize.height);
    void this.plugin.saveData(this.plugin.settings);
  }
  placePdf(){
    if(!this.pdfWorld||!this.popup||this.popup.hidden||this.pdfKey!==this.focusPath)return;
    const camera=this.camera();
    // Hover stays visually near a moving physics node, with hysteresis to
    // prevent trembling. Click-lock and actual PDF reading stop auto-follow.
    if(!this.lockedPath&&!this.isInPopup&&!this.drag&&this.pdfNodeOffset){
      const node=this.adapter.getNode(this.focusPath);
      if(node&&Number.isFinite(node.x)&&Number.isFinite(node.y)){
        const desired={x:node.x+this.pdfNodeOffset.x,y:node.y+this.pdfNodeOffset.y};
        const gap=Math.hypot(desired.x-this.pdfWorld.x,desired.y-this.pdfWorld.y)*camera.scale/(camera.dpr||1);
        if(gap>16){this.pdfWorld.x+=(desired.x-this.pdfWorld.x)*.22;this.pdfWorld.y+=(desired.y-this.pdfWorld.y)*.22;}
      }
    }
    const screen=worldToScreen(this.pdfWorld,camera);
    const zoom=graphScaleFactor(this.adapter.renderer,this.pdfInitialScale);
    if(!screen||!Number.isFinite(zoom))return;
    const popup=this.popup;
    popup.style.left=`${screen.x}px`;
    popup.style.top=`${screen.y}px`;
    popup.style.width=`${this.pdfBaseSize.width}px`;
    popup.style.height=`${this.pdfBaseSize.height}px`;
    popup.style.transform=`scale(${zoom})`;
    // PDF content and window resize corners keep their native CSS pixel
    // metrics; the containing panel is what follows original graph zoom.
  }
  onModelUpdated(){
    if(this.lockedPath&&!this.plugin.isScopedPath(this.lockedPath)){this.unlock();return;}
    this.renderEdgeLabels();
    if(!this.focusPath)return;
    const node=nodeFromGraphPath(this.focusPath,this.plugin.model||{nodes:[]});
    if(!node){this.setFocus('');return;}
    // Do NOT rebuild PDF on every note/edit/sync event: retain its scroll
    // position, document state and (manual) window size if source unchanged.
    if(this.pdfKey===this.focusPath&&this.pdfSignature===this.pdfSignatureFor(node)){
      // Markdown body links may change without a frontmatter change.
      if(this.pdfResolved?.kind==='remote'){
        const check=++this.pdfCheckSeq,path=this.focusPath;
        void this.plugin.app.vault.cachedRead(node.file).then(text=>{
          if(this.destroyed||check!==this.pdfCheckSeq||this.focusPath!==path)return;
          const updated=discoverPdfUrl(text,{pdf_url:node.pdfUrl});
          if(updated&&updated!==this.pdfResolved?.url){this.hidePdf();void this.updatePdf(path);}
        }).catch(()=>{});
      }
      return;
    }
    if(this.pdfKey===this.focusPath){this.hidePdf();this.pdfTimer=setTimeout(()=>void this.updatePdf(this.focusPath),180);}
  }
}
