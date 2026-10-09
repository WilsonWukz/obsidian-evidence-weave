'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('module');
const originalLoad=Module._load;
class EmptyPlugin {}
Module._load=function(id,...args){
 if(id==='obsidian')return {Plugin:EmptyPlugin,PluginSettingTab:class{},Setting:class{},Notice:class{},Component:class{},
   MarkdownRenderer:{render:async()=>{}},parseYaml:(text)=>Object.fromEntries(text.split(/\r?\n/).filter(l=>/^[a-z_]\w*:\s*/.test(l))
   .map(l=>{const match=l.match(/^([^:]+):\s*(.*)$/);let v=match[2];try{v=JSON.parse(v)}catch(_){}return [match[1],v]}))};
 return originalLoad.call(this,id,...args);
};
const x=require('../main.js')._test;
Module._load=originalLoad;
const nodes=[{id:'C00',path:'INSES/C00-INSES.md',basename:'C00-INSES'},
 {id:'P21',path:'INSES/P21-Dense-X-Retrieval.md',basename:'P21-Dense-X-Retrieval'},
 {id:'M00',path:'INSES/M00-关系总览.md',basename:'M00-关系总览'}];
const index=x.buildNodeIndex(nodes);
const overview='- [[P21-Dense-X-Retrieval#^R-P21-01|P21 · Dense X Retrieval]]：INSES 细粒度检索背景。 状态：有限关系已审；整合待验收。\n';
const legacy=x.parseOverviewRelationships(overview,nodes[0],index,'INSES/M00-关系总览.md')[0];
const short=overview+'  - **图谱正向短句**：提供细粒度检索背景\n  - **图谱反向短句**：被 INSES 用于检索粒度讨论\n';
const source='INSES/C00-INSES.md',target='INSES/P21-Dense-X-Retrieval.md',m00='INSES/M00-关系总览.md';

test('recognizes the original long evidence source but no implicit short label',()=>{
 assert.equal(legacy.id,'R-P21-01');assert.equal(x.shortLabelFor(legacy,'C00'),'');assert.match(legacy.summaryFromSource,/检索背景/);
});
test('parses two explicit directional short labels independent of the long evidence',()=>{
 const r=x.parseOverviewRelationships(short,nodes[0],index,m00)[0];
 assert.equal(r.labelFromSource,'提供细粒度检索背景');assert.equal(r.labelFromTarget,'被 INSES 用于检索粒度讨论');
 assert.equal(r.summaryFromSource,legacy.summaryFromSource);
});
test('writes missing forward short label without editing the evidence sentence',()=>{
 const out=x.patchOverviewLabel(overview,legacy,'C00','关联细粒度检索背景');
 assert.match(out,/图谱正向短句.*关联细粒度检索背景/);
 assert.match(out,/图谱短句审核.*用户修改待复核/);
 assert.match(out,/INSES 细粒度检索背景。 状态：有限关系已审/);
});
test('writes a reverse label and can replace it later without duplication',()=>{
 const a=x.patchOverviewLabel(overview,legacy,'P21','被引用于粒度讨论');
 const v=x.parseOverviewRelationships(a,nodes[0],index,m00)[0];
 const b=x.patchOverviewLabel(a,v,'P21','作为检索粒度背景被引用');
 assert.equal((b.match(/图谱反向短句/g)||[]).length,1);
 assert.match(b,/作为检索粒度背景被引用/);
});
test('label write refuses stale evidence, duplicate relation ids and newline',()=>{
 assert.throws(()=>x.patchOverviewLabel(overview.replace('背景','脉络'),legacy,'C00','短句'),/已变化/);
 assert.throws(()=>x.patchOverviewLabel(overview+overview,legacy,'C00','短句'),/重复/);
 assert.throws(()=>x.validateShortLabel('a\nb'),/单行/);
});
test('label length hard-limit and normal Chinese values',()=>{
 assert.equal(x.validateShortLabel('以 RAG 作为比较对象'),'以 RAG 作为比较对象');
 assert.throws(()=>x.validateShortLabel('a'.repeat(71)),/1–70/);
});
test('typed YAML writes only label and label review status, not evidence review',()=>{
 const raw='---\nrelation_id: R1\nsource: C00\ntarget: P21\nsummary_from_source: "这是完整解释"\nsummary_from_target: "引用关系解释"\nreview_status: reviewed\n---\nEvidence remains.\n';
 const r={id:'R1',kind:'typed',source:'C00',target:'P21',labelFromSource:'',labelFromTarget:'',storage:{note:'INSES/relations/r.md',sourceKey:'C00',targetKey:'P21'}};
 const p=x.patchTypedLabel(raw,r,'P21','反向短句',v=>Object.fromEntries(v.split('\n').filter(a=>a.includes(':')).map(l=>{const [k,...parts]=l.split(':');let val=parts.join(':').trim();try{val=JSON.parse(val)}catch(_){}return[k,val]})));
 assert.match(p,/label_from_target: "反向短句"/);assert.match(p,/review_status: reviewed/);
 assert.match(p,/label_review_status: unverified/);assert.match(p,/Evidence remains\./);
});
test('never transfers C00 claims onto M00 navigation links',()=>{
 const m={nodes,edges:[legacy]};
 assert.equal(x.matchNativeRelation(m00,target,m,m00).length,0);
 assert.equal(x.matchNativeRelation(source,target,m,m00).length,1);
 assert.equal(x.matchNativeRelation(source,m00,m,m00).length,0);
});
test('native node identity is used for both directional label viewpoints',()=>{
 const by=new Map(nodes.map(n=>[n.path,n]));
 assert.equal(x.viewpointForNativeRelation(source,legacy,by,m00),'C00');
 assert.equal(x.viewpointForNativeRelation(target,legacy,by,m00),'P21');
 assert.equal(x.viewpointForNativeRelation(m00,legacy,by,m00),'');
});
test('default PDF height and width are never silently reduced in a small viewport',()=>{
 const p=x.pdfOriginForNode({x:120,y:220},{width:700,height:440},495,810);
 assert.equal(p.width,495);assert.equal(p.height,810);
 assert.equal(p.side,'left'===p.side?'left':'right');
});
test('PDF initially selects left side if node is near right edge',()=>{
 const p=x.pdfOriginForNode({x:900,y:300},{width:1000,height:900},495,810);
 assert.equal(p.side,'left');assert.ok(p.x<900);
});
test('narrow viewport is handled without creating a tiny, unreadable PDF',()=>{
 assert.equal(x.pdfOriginForNode({x:20,y:50},{width:200,height:500}),null);
});
test('graph camera changes move and zoom PDF as one object',()=>{
 const before={scale:2,panX:100,panY:80,dpr:2};
 const point={x:240,y:150};
 const world=x.screenToWorld(point,before);
 assert.deepEqual(x.worldToScreen(world,before),point);
 const after={scale:4,panX:180,panY:120,dpr:2};
 const newScreen=x.worldToScreen(world,after);
 assert.equal(x.graphScaleFactor(after,before.scale),2);
 assert.ok(newScreen.x!==point.x&&newScreen.y!==point.y);
});
test('all four PDF resize corners adjust dimensions and correct world origin',()=>{
 const orig={x:12,y:32,width:495,height:810};
 const cam={scale:2,panX:0,panY:0,dpr:1};
 const se=x.resizedWorldPanel(orig,{x:100,y:80,corner:'se'},cam,2);
 assert.equal(se.width,545);assert.equal(se.height,850);assert.equal(se.x,12);
 const nw=x.resizedWorldPanel(orig,{x:-100,y:-80,corner:'nw'},cam,2);
 assert.equal(nw.width,545);assert.equal(nw.height,850);assert.equal(nw.x,-38);assert.equal(nw.y,-8);
 const ne=x.resizedWorldPanel(orig,{x:40,y:-40,corner:'ne'},cam,2);
 assert.equal(ne.width,515);assert.equal(ne.height,830);assert.equal(ne.x,12);assert.equal(ne.y,12);
 const sw=x.resizedWorldPanel(orig,{x:-40,y:40,corner:'sw'},cam,2);
 assert.equal(sw.width,515);assert.equal(sw.height,830);assert.equal(sw.x,-8);assert.equal(sw.y,32);
});
test('resizer respects safe dimensions even beyond extreme mouse distances',()=>{
 const orig={x:0,y:0,width:495,height:810};
 const p=x.resizedWorldPanel(orig,{x:-9999,y:-9999,corner:'se'},{scale:1,dpr:1},1);
 assert.equal(p.width,320);assert.equal(p.height,360);
});
test('geometry puts short labels along actual edge and keeps text upright',()=>{
 const a=x.labelPosition({x:10,y:20},{x:110,y:20},.5);
 assert.equal(a.x,60);assert.equal(a.angle,0);
 assert.ok(Math.abs(x.readableEdgeAngle(-3,-4))<=Math.PI/2);
});
test('label collision solver rejects labels competing for the same segment',()=>{
 const candidates=[{id:1,a:{x:0,y:100},b:{x:420,y:100},width:200,height:21},
 {id:2,a:{x:0,y:101},b:{x:420,y:101},width:200,height:21}];
 const out=x.avoidLabelCollisions(candidates);
 assert.equal(out[0].id,1);
 assert.ok(out.length<=2);
 if(out.length===2)assert.ok(Math.abs(out[0].x-out[1].x)>35);
});
test('PDF overlap prevents a relation label from covering the reader',()=>{
 const candidates=[{id:1,a:{x:20,y:50},b:{x:400,y:50},width:120,height:24}];
 const result=x.avoidLabelCollisions(candidates,{left:0,right:450,top:0,bottom:80});
 assert.equal(result.length,0);
});
test('composing Chinese Enter does not commit editor contents',()=>{
 assert.equal(x.eventMayCommit({key:'Enter',isComposing:true}),false);
 assert.equal(x.eventMayCommit({key:'Enter',keyCode:229}),false);
 assert.equal(x.eventMayCommit({key:'Enter',isComposing:false,repeat:false}),true);
});
test('renderer unpatch restores native methods without modifying node coordinates',()=>{
 global.window={devicePixelRatio:2};global.HTMLElement=class{};
 const container=new HTMLElement();container.nodeType=1;
 const node={id:target,x:12,y:15};
 const r={containerEl:container,links:[],nodeLookup:{[target]:node},scale:2,panX:100,panY:50,
  onNodeClick(){this.nativeClicks=(this.nativeClicks||0)+1;},getHighlightNode(){return this.highlightNode;},changed(){this.repainted=true;},highlightNode:null};
 assert.equal(x.rendererFromLeaf({view:{getViewType:()=> 'graph',renderer:r}}),r);
 const adapter=new x.NativeGraphAdapter(r),beforeClick=r.onNodeClick,beforeHover=r.getHighlightNode;
 let lock=node;
 adapter.mount((_,id)=>id===target,()=>lock);
 r.onNodeClick({button:0},target,'file'); assert.equal(r.nativeClicks||0,0);
 node.x=50;node.y=60; // independent native physics keeps moving nodes
 assert.deepEqual(adapter.screenPosition(node),{x:100,y:85});
 adapter.unmount();assert.equal(r.onNodeClick,beforeClick);assert.equal(r.getHighlightNode,beforeHover);
});
test('unpatch does not clobber subsequently installed plugins',()=>{
 const r={onNodeClick(){},getHighlightNode(){return null},nodeLookup:{},links:[],changed(){}};
 const adapter=new x.NativeGraphAdapter(r);adapter.mount(()=>false,()=>null);
 const other=()=>42;r.onNodeClick=other;adapter.unmount();assert.equal(r.onNodeClick,other);
});
test('model refresh preserves PDF if its source did not change',()=>{
 const node={id:'P21',path:target,pdfPath:'',pdfUrl:'https://example.org/paper.pdf'};
 const binding=Object.create(x.NativeGraphBinding.prototype);
 let hidden=0,updated=0,rendered=0;
 binding.lockedPath='';binding.focusPath=target;binding.pdfKey=target;
 binding.pdfSignature=[target,'','https://example.org/paper.pdf'].join('|');
 binding.plugin={model:{nodes:[node]},isScopedPath:()=>true};
 binding.renderEdgeLabels=()=>{rendered++};binding.hidePdf=()=>hidden++;
 binding.updatePdf=()=>{updated++};
 binding.onModelUpdated();
 assert.equal(rendered,1);assert.equal(hidden,0);assert.equal(updated,0);
});
