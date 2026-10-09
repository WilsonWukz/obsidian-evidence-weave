/* EvidenceWeave v0.3 — unobtrusive enhancements to the NATIVE Graph View.
 * No ItemView, no graph drawing, no R2/Cloud/MCP, no automatic Vault mutation.
 */
'use strict';
const {Plugin,PluginSettingTab,Setting,Notice,MarkdownRenderer,Component,parseYaml,requestUrl}=require('obsidian');
const NODE_KINDS=new Set(['paper','concept','method','dataset','question','center']);
const DEFAULT_SETTINGS=Object.freeze({
  projectFolder:'INSES',overviewPath:'INSES/M00-关系总览.md',
  pdfWidth:495,pdfHeight:810,rememberPdfSize:true,labelMaxChars:32,
});

class EvidenceWeaveSettings extends PluginSettingTab{
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    const {containerEl}=this;containerEl.empty();
    containerEl.createEl('h2',{text:'EvidenceWeave · 原生图谱增强'});
    containerEl.createEl('p',{text:'只增强原生关系图谱；没有独立图谱页面。节点点击锁定，点击空白取消。Command/Ctrl 点击沿用原生打开笔记。'});
    new Setting(containerEl).setName('研究文件夹').setDesc('只展示此目录中经过记录的论文关系；空值表示整个 Vault。')
      .addText(t=>t.setValue(this.plugin.settings.projectFolder).onChange(async v=>{
        this.plugin.settings.projectFolder=cleanFolder(v);await this.plugin.saveData(this.plugin.settings);await this.plugin.refreshModel();}));
    new Setting(containerEl).setName('关系总览笔记路径').setDesc('读取 M00 中带 R-Pxx 证据锚点的关系说明。')
      .addText(t=>t.setValue(this.plugin.settings.overviewPath).onChange(async v=>{
        this.plugin.settings.overviewPath=str(v);await this.plugin.saveData(this.plugin.settings);await this.plugin.refreshModel();}));
    new Setting(containerEl).setName('PDF 默认宽度').setDesc('PDF 会随原生图谱一起缩放，也支持拖动四角改变宽高。').addSlider(sl=>sl.setLimits(320,900,5)
      .setValue(this.plugin.settings.pdfWidth).setDynamicTooltip().onChange(async v=>{
        this.plugin.settings.pdfWidth=v;await this.plugin.saveData(this.plugin.settings);}));
    new Setting(containerEl).setName('PDF 默认高度').addSlider(sl=>sl.setLimits(360,1300,10)
      .setValue(this.plugin.settings.pdfHeight).setDynamicTooltip().onChange(async v=>{
        this.plugin.settings.pdfHeight=v;await this.plugin.saveData(this.plugin.settings);}));
    new Setting(containerEl).setName('记住拖拽后的 PDF 尺寸')
      .setDesc('拖动窗口四角后，新尺寸成为以后打开 PDF 的默认尺寸。')
      .addToggle(t=>t.setValue(this.plugin.settings.rememberPdfSize).onChange(async v=>{
        this.plugin.settings.rememberPdfSize=v;await this.plugin.saveData(this.plugin.settings);
      }));
  }
}

class EvidenceWeavePlugin extends Plugin{
  async onload(){
    const data=await this.loadData()||{};
    this.settings={...DEFAULT_SETTINGS,...data};
    if(!data.__ewSchemaVersion || data.__ewSchemaVersion<4){
      // v0.3 width/height defaults were 330x450. Upgrade only unchanged
      // defaults; preserve manually adjusted existing PDF window sizes.
      if(data.pdfWidth===undefined||data.pdfWidth===330)this.settings.pdfWidth=495;
      if(data.pdfHeight===undefined||data.pdfHeight===450)this.settings.pdfHeight=810;
      this.settings.__ewSchemaVersion=4;
      await this.saveData(this.settings);
    }
    this.model={nodes:[],edges:[]};this.bindings=new Map();
    this.pendingRefresh=0;
    await this.refreshModel();
    this.addSettingTab(new EvidenceWeaveSettings(this.app,this));
    this.addCommand({id:'open-native-graph',name:'Open original graph with EvidenceWeave',callback:()=>{
      const leaf=this.app.workspace.getLeavesOfType('graph')[0];
      if(leaf)this.app.workspace.revealLeaf(leaf);
      else this.app.commands.executeCommandById('graph:open');
    }});
    this.addCommand({id:'unlock-native-graph',name:'Unlock current native graph focus',callback:()=>{
      for(const binding of this.bindings.values())binding.unlock();
    }});
    const refresh=()=>{clearTimeout(this.pendingRefresh);this.pendingRefresh=setTimeout(()=>void this.refreshModel(),360);};
    this.registerEvent(this.app.metadataCache.on('changed',refresh));
    this.registerEvent(this.app.workspace.on('layout-change',()=>this.attachGraphs()));
    this.registerEvent(this.app.workspace.on('active-leaf-change',()=>this.attachGraphs()));
    this.registerInterval(window.setInterval(()=>this.attachGraphs(),1250));
    this.app.workspace.onLayoutReady(()=>this.attachGraphs());
  }
  async onunload(){
    clearTimeout(this.pendingRefresh);
    for(const binding of this.bindings.values())binding.detach();
    this.bindings.clear();
  }
  isScopedPath(path){
    const folder=cleanFolder(this.settings.projectFolder);
    return !folder||path.startsWith(folder+'/');
  }
  async refreshModel(){
    try{
      this.model=await buildGraphModel(this.app,this.settings);
      for(const binding of this.bindings?.values()||[])binding.onModelUpdated();
    }catch(e){console.error('[EvidenceWeave] Failed to read local relations',e);
      new Notice('EvidenceWeave: 读取本地文献关系失败');}
  }
  attachGraphs(){
    if(!this.bindings)return;
    const leaves=[...this.app.workspace.getLeavesOfType('graph'),
      ...this.app.workspace.getLeavesOfType('localgraph')];
    const seen=new Set(leaves);
    for(const [leaf,binding] of this.bindings){
      const renderer=rendererFromLeaf(leaf);
      if(!seen.has(leaf)||!renderer||binding.adapter.renderer!==renderer){binding.detach();this.bindings.delete(leaf);}
    }
    for(const leaf of leaves){
      if(this.bindings.has(leaf))continue;
      const renderer=rendererFromLeaf(leaf);
      if(!renderer)continue;
      try{const binding=new NativeGraphBinding(this,leaf,renderer);binding.attach();this.bindings.set(leaf,binding);}
      catch(e){console.warn('[EvidenceWeave] Unsupported graph renderer internals',e);}
    }
  }
}
module.exports=EvidenceWeavePlugin;
// Pure helpers for unit tests (Obsidian ignores extra exports).
module.exports._test={placePdfByNode,readableEdgeAngle,labelPosition,matchNativeRelation,
  viewpointForNativeRelation,patchOverviewSummary,patchTypedSummary,
  parseOverviewRelationships,buildNodeIndex,discoverPdfUrl,rendererFromLeaf,NativeGraphAdapter,
  shortLabelFor,patchOverviewLabel,patchTypedLabel,validateShortLabel,
  screenToWorld,worldToScreen,graphScaleFactor,pdfOriginForNode,resizedWorldPanel,
  avoidLabelCollisions,NativeGraphBinding,eventMayCommit};
