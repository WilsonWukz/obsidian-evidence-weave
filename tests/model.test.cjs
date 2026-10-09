'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const orig=Module._load;
Module._load=function(name,...rest){if(name==='obsidian'){class Empty{};return {Plugin:Empty,ItemView:Empty,PluginSettingTab:Empty,Setting:Empty,Notice:Empty,Component:Empty,MarkdownRenderer:{}};}return orig.call(this,name,...rest)};
const exported=require('../src/main.js');
Module._load=orig;
const m=exported._test;
const nodes=[{id:'C00',path:'INSES/C00-INSES.md',basename:'C00-INSES'},
{id:'P21',path:'INSES/P21-Dense-X-Retrieval.md',basename:'P21-Dense-X-Retrieval'},
{id:'P18',path:'INSES/P18-RAG.md',basename:'P18-RAG'}];
const index=m.buildNodeIndex(nodes);
test('plugin exports Obsidian entrypoint',()=>assert.equal(exported.default,exported));
test('extracts only anchored overview relations',()=>{
const text='- [[P21-Dense-X-Retrieval#^R-P21-01|P21]]：这是合成测试关系。 状态：有限关系已审。\n- [[P18-RAG|P18]]：这只是笔记双链。';
const r=m.parseOverviewRelationships(text,nodes[0],index,'INSES/M00-关系总览.md');
assert.equal(r.length,1);assert.equal(r[0].id,'R-P21-01');assert.equal(r[0].status,'limited_reviewed');
});
test('typed relations require two summaries and unambiguous nodes',()=>{
const r=m.parseTypedRelationship({relation_id:'R1',source:'P21',target:'P18',summary_from_source:'from P21',summary_from_target:'from P18'},index);
assert.equal(m.directedSummary(r,'P18'),'from P18');
assert.equal(m.parseTypedRelationship({relation_id:'bad',source:'absent',target:'P18',summary_from_source:'x',summary_from_target:'y'},index),null);
});
test('safe URLs reject dangerous protocols',()=>{assert.equal(m.safeWebUrl('javascript:alert(1)'),null);assert.equal(m.safeWebUrl('file:///secret'),null);assert.equal(m.safeWebUrl('https://example.org/file.pdf'),'https://example.org/file.pdf')});
test('typed relation overrides legacy same id',()=>{const base={id:'R1',source:'C00',target:'P21',kind:'overview'};assert.equal(m.uniqueRelations([base],[{...base,kind:'typed'}],[])[0].kind,'typed')});
test('deterministic graph positions',()=>assert.deepEqual([...m.initialLayout(nodes,[],'C00')],[...m.initialLayout(nodes,[],'C00')]));
