'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Module=require('module');
const orig=Module._load;
class EmptyPlugin {}
Module._load=function(id,...args){
  if(id==='obsidian')return {Plugin:EmptyPlugin,PluginSettingTab:class{},Setting:class{},Notice:class{},
    MarkdownRenderer:{renderMarkdown:async()=>{}},parseYaml:()=>({})};
  return orig.call(this,id,...args);
};
const x=require('../main.js')._test;
Module._load=orig;
const nodes=[{id:'C00',path:'INSES/C00-INSES.md',basename:'C00-INSES'},
  {id:'P21',path:'INSES/P21-Dense-X-Retrieval.md',basename:'P21-Dense-X-Retrieval'}];
const index=x.buildNodeIndex(nodes);
const overview='- [[P21-Dense-X-Retrieval#^R-P21-01|P21 · Dense X Retrieval]]：INSES 细粒度检索背景。 状态：有限关系已审；整合待验收。\n';
const rel=x.parseOverviewRelationships(overview,nodes[0],index,'INSES/M00-关系总览.md')[0];
test('loads the source relation with editable Markdown line',()=>{
  assert.equal(rel.id,'R-P21-01');assert.equal(rel.kind,'overview');assert.equal(rel.status,'limited_reviewed');
  assert.equal(rel.storage.note,'INSES/M00-关系总览.md');
});
test('positions PDF on right when possible',()=>{
  const c=x.placePdfByNode({x:120,y:180},{width:1000,height:620},330,450);
  assert.equal(c.side,'right');assert.ok(c.x>120);assert.equal(c.height,450);
});
test('positions PDF on left when right has inadequate room',()=>{
  const c=x.placePdfByNode({x:930,y:300},{width:1000,height:620},330,450);
  assert.equal(c.side,'left');assert.ok(c.x+330<930);
});
test('small viewport clamps PDF inside bounds',()=>{
  const c=x.placePdfByNode({x:280,y:100},{width:350,height:190},330,460);
  assert.ok(c.x>=12&&c.x+c.width<=338);assert.ok(c.y>=12&&c.y+c.height<=178);
});
test('no panel for impractically narrow viewport',()=>assert.equal(x.placePdfByNode({x:20,y:20},{width:250,height:400}),null));
test('rotation follows edge but never inverts text',()=>{
  assert.ok(Math.abs(x.readableEdgeAngle(-3,-4))<=Math.PI/2);
  assert.ok(Math.abs(x.readableEdgeAngle(3,4))<=Math.PI/2);
});
test('label points along actual geometric edge',()=>{
  const p=x.labelPosition({x:10,y:20},{x:110,y:20},.5);
  assert.equal(p.x,60);assert.equal(p.y,20);assert.equal(p.angle,0);
});
test('maps actual M00↔P21 link to M00 overview source without inventing an edge',()=>{
  const model={nodes,edges:[rel]};
  const mapped=x.matchNativeRelation('INSES/M00-关系总览.md','INSES/P21-Dense-X-Retrieval.md',model,'INSES/M00-关系总览.md');
  assert.equal(mapped.length,1);assert.equal(mapped[0].proxy,true);
  assert.equal(x.matchNativeRelation('INSES/rolling-ledger.md','INSES/P21-Dense-X-Retrieval.md',model,'INSES/M00-关系总览.md').length,0);
});
test('uses target viewpoint when hovering linked paper',()=>{
  const model={nodes,edges:[rel]};const by=new Map(nodes.map(n=>[n.path,n]));
  assert.equal(x.viewpointForNativeRelation(nodes[1].path,rel,by,'INSES/M00-关系总览.md'),'P21');
  assert.equal(x.viewpointForNativeRelation('INSES/M00-关系总览.md',rel,by,'INSES/M00-关系总览.md'),'C00');
});
test('writing a summary preserves anchor and marks user-edited review status',()=>{
  const updated=x.patchOverviewSummary(overview,rel,'C00','我刚刚改了它的学术关系解释');
  assert.match(updated,/我刚刚改了它的学术关系解释 状态：用户修改待复核。/);
  assert.match(updated,/#\^R-P21-01/);
});
test('prevents overwriting an externally modified relationship',()=>{
  assert.throws(()=>x.patchOverviewSummary(overview.replace('背景','机制'),rel,'C00','修改'),/已变化/);
});
test('rejects unsafe inline values and does not write unverified links',()=>{
  assert.throws(()=>x.patchOverviewSummary(overview,rel,'C00','a\nb'),/单行/);
  assert.throws(()=>x.patchOverviewSummary(overview,{...rel,kind:'wikilink'},'C00','测试'),/只有带来源/);
});

test('native renderer click interception restores native behavior after detach',()=>{
  global.window={devicePixelRatio:2};
  // Minimal simulated container and Obsidian renderer; this is NOT a real-app test.
  global.HTMLElement=class{};
  const container=new HTMLElement();container.nodeType=1;
  const renderer={containerEl:container,links:[],nodeLookup:{'INSES/C00-INSES.md':{id:'INSES/C00-INSES.md',x:10,y:5,weight:2}},
    scale:2,panX:100,panY:60,changed(){this.repainted=true;},highlightNode:null,
    onNodeClick(){this.originalClicks=(this.originalClicks||0)+1;}};
  const cls=x.rendererFromLeaf({view:{getViewType:()=> 'graph',renderer}});
  assert.equal(cls,renderer);
});

test('native adapter locks original highlight without ever redrawing edges',()=>{
  global.window={devicePixelRatio:1};
  const node={id:'INSES/P21-Dense-X-Retrieval.md',x:10,y:15};
  const r={nodeLookup:{[node.id]:node},links:[],containerEl:{nodeType:1},
    highlightNode:null,scale:1,panX:20,panY:30,
    onNodeClick(){this.calls=(this.calls||0)+1;},
    getHighlightNode(){return this.highlightNode;},
    changed(){this.repainted=true;}};
  const adapter=new x.NativeGraphAdapter(r);
  let lock=null;let received=0;
  adapter.mount((_event,id)=>{if(id===node.id){lock=node;received++;return true;}return false;},()=>lock);
  r.onNodeClick({button:0},node.id,'file');
  assert.equal(r.calls||0,0);assert.equal(received,1);
  assert.equal(r.getHighlightNode(),node);
  r.onNodeClick({button:0},'other','file');
  assert.equal(r.calls,1);
  adapter.unmount();
  assert.equal(r.getHighlightNode(),null);
  r.onNodeClick({},node.id,'file');assert.equal(r.calls,2);
  assert.deepEqual(adapter.screenPosition(node),{x:30,y:45});
});
test('unpatch does not clobber another plugin that patched after ours',()=>{
  const native=()=>true;
  const renderer={onNodeClick:native,getHighlightNode:()=>null,links:[],nodeLookup:{},
    scale:1,panX:0,panY:0,changed(){}};
  const adapter=new x.NativeGraphAdapter(renderer);
  adapter.mount(()=>false,()=>null);
  const laterPlugin=()=>42;
  renderer.onNodeClick=laterPlugin;
  adapter.unmount();
  assert.equal(renderer.onNodeClick,laterPlugin);
});
