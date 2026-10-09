/* EvidenceWeave — local-first scholarly evidence navigator for Obsidian.
 * No network, sync or MCP code; reads only the current Vault.
 * Built with zero third-party runtime dependencies.
 */
'use strict';
const { Plugin, ItemView, MarkdownRenderer, PluginSettingTab, Setting, Notice } = require('obsidian');

const VIEW_TYPE = 'evidence-weave-graph';
const DEFAULT_SETTINGS = Object.freeze({
  projectFolder: 'INSES',
  overviewPath: 'INSES/M00-关系总览.md',
  showUnverifiedLinks: false,
  previewRemotePdfs: true,
  graphReaderWidth: 40,
});
const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_KINDS = new Set(['paper', 'concept', 'method', 'dataset', 'question', 'center']);

function str(value) { return typeof value === 'string' ? value.trim() : ''; }
function cleanFolder(value) { return str(value).replace(/^\/+|\/+$/g, ''); }
function withinFolder(path, folder) { return !folder || path.startsWith(`${folder}/`); }
function nodeLabel(node) {
  if (!node) return '';
  const base = node.basename;
  return base.length > 33 ? `${base.slice(0, 31)}…` : base;
}
function clamp(num, min, max) { return Math.min(max, Math.max(min, num)); }
function safeWebUrl(url) {
  const value = str(url).replace(/[),.;]+$/, '');
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch { return null; }
}
function stripStatus(text) {
  return str(text).replace(/\s*状态[:：]\s*.+$/u, '').trim();
}
function shorten(text, max = 54) {
  const value = str(text).replace(/\s+/g, ' ');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
function edgeReviewStatus(raw) {
  const val = str(raw).toLowerCase().replace(/[- ]/g, '_');
  if (val === 'reviewed' || val === 'verified') return 'reviewed';
  if (val.includes('limited') || val.includes('partial')) return 'limited_reviewed';
  return 'unverified';
}
function buildNodeIndex(nodes) {
  const groups = new Map();
  for (const node of nodes) {
    for (const key of [node.id, node.path, node.basename]) {
      if (!key) continue;
      const trimmed = str(key);
      const matches = groups.get(trimmed) || [];
      if (!matches.includes(node)) matches.push(node);
      groups.set(trimmed, matches);
    }
  }
  return {
    byKey: groups,
    resolve(value) {
      const ref = str(value).replace(/\.md$/i, (m) => m);
      const exact = groups.get(ref);
      if (exact?.length === 1) return exact[0];
      // A link with an anchor is still a reference to its note.
      const noAnchor = ref.split('#')[0];
      if (noAnchor !== ref) {
        const candidates = groups.get(noAnchor);
        if (candidates?.length === 1) return candidates[0];
      }
      return null; // ambiguous references must not be guessed
    }
  };
}
function parseOverviewRelationships(markdown, sourceNode, index, overviewPath) {
  if (!sourceNode) return [];
  const result = [];
  for (const line of markdown.split(/\r?\n/)) {
    // Require both an exact Obsidian relation block and an explanatory sentence.
    const match = line.match(/^\s*-\s*\[\[([^|\]]+)\|[^\]]+\]\]\s*[：:]\s*(.+)$/u);
    if (!match) continue;
    const linkTarget = match[1];
    const anchorMatch = linkTarget.match(/#\^([A-Za-z0-9-]+)$/);
    if (!anchorMatch || !/^R-[A-Za-z0-9-]+$/.test(anchorMatch[1])) continue;
    const dest = index.resolve(linkTarget.split('#')[0]);
    if (!dest || dest.id === sourceNode.id) continue;
    const description = stripStatus(match[2]);
    if (!description) continue;
    result.push({
      id: anchorMatch[1], source: sourceNode.id, target: dest.id,
      type: 'citation_context', kind: 'overview',
      status: /状态[:：]\s*有限关系已审/u.test(match[2]) ? 'limited_reviewed' : 'unverified',
      summaryFromSource: description,
      summaryFromTarget: `该文献在 ${sourceNode.basename} 中的作用：${description}`,
      evidence: { note: dest.path, block: anchorMatch[1], sourceNote: overviewPath },
    });
  }
  return result;
}
function parseTypedRelationship(frontmatter, index) {
  if (!frontmatter || !str(frontmatter.relation_id)) return null;
  const source = index.resolve(frontmatter.source || frontmatter.source_id);
  const target = index.resolve(frontmatter.target || frontmatter.target_id);
  if (!source || !target || source.id === target.id) return null;
  const from = str(frontmatter.summary_from_source);
  const to = str(frontmatter.summary_from_target);
  // Reject silent blank relationships that could be misinterpreted as evidence.
  if (!from || !to) return null;
  const rawEvidence = Array.isArray(frontmatter.evidence) ? frontmatter.evidence[0] : frontmatter.evidence;
  const ev = rawEvidence && typeof rawEvidence === 'object' ? rawEvidence : {};
  const page = Number(ev.page);
  return {
    id: str(frontmatter.relation_id),
    source: source.id,
    target: target.id,
    type: str(frontmatter.relation_type) || 'related',
    kind: 'typed',
    status: edgeReviewStatus(frontmatter.review_status),
    summaryFromSource: from,
    summaryFromTarget: to,
    evidence: {
      note: str(ev.note), block: str(ev.block).replace(/^\^/, ''),
      section: str(ev.section), quote: str(ev.quote),
      page: Number.isInteger(page) && page > 0 ? page : null,
      pdfUrl: safeWebUrl(ev.pdf_url),
    },
  };
}
function extractLegacyEvidence(markdown, relationId) {
  if (!relationId || !/^R-[A-Za-z0-9-]+$/.test(relationId)) return {};
  const start = markdown.search(new RegExp(`^#{2,6}\\s+${relationId}\\s*$`, 'm'));
  if (start < 0) return {};
  const tail = markdown.slice(start).split(/\r?\n/);
  const section = [];
  for (let i = 1; i < tail.length; i++) {
    if (/^#{2,6}\s+/.test(tail[i])) break;
    section.push(tail[i]);
  }
  const body = section.join('\n');
  const quoteLine = section.find(line => /(?:英文|原文|短引|节选|摘录)/u.test(line) && /[“"]/.test(line)) || '';
  const quote = quoteLine.match(/[“"]([^”"]{8,450})[”"]/)?.[1] || '';
  const locationLine = section.find(line => /(?:位置|PDF|§)/u.test(line)) || '';
  const pdfMatch = body.match(/\((https?:\/\/[^\s)]+\.pdf(?:#[^\s)]+)?)\)/i);
  const candidatePage = body.match(/(?:PDF\s*(?:第\s*)?|PDF\/文内p)\s*(\d{1,4})/iu);
  const page = Number(candidatePage?.[1]);
  return {
    quote, section: shorten(locationLine, 170),
    pdfUrl: pdfMatch ? safeWebUrl(pdfMatch[1]) : null,
    page: Number.isInteger(page) && page > 0 ? page : null,
  };
}
function discoverPdfUrl(markdown, metadata = {}) {
  const metaPdf = safeWebUrl(metadata.pdf_url || metadata.pdfUrl);
  if (metaPdf && /\.pdf(?:[?#]|$)/i.test(metaPdf)) return metaPdf;
  // Prefer an explicit PDF source link rather than an unrelated bibliography link.
  const direct = [...markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)]
    .find(m => /(?:PDF|全文|原文)/i.test(m[1]) && /\.pdf(?:[?#]|$)/i.test(m[2]));
  if (direct) return safeWebUrl(direct[2]);
  const plain = markdown.match(/https?:\/\/[^\s<>"'()]+\.pdf(?:#[^\s<>"'()]*)?/i);
  return plain ? safeWebUrl(plain[0]) : null;
}
function directedSummary(relation, focusId) {
  return focusId === relation.target ? relation.summaryFromTarget : relation.summaryFromSource;
}
function uniqueRelations(overview, typed, observed) {
  // Prefer user-maintained structured records over inferred legacy display records.
  const combined = new Map();
  for (const relation of overview) combined.set(relation.id, relation);
  for (const relation of typed) combined.set(relation.id, relation);
  const existingPairs = new Set([...combined.values()].map(e => [e.source, e.target].sort().join('|')));
  for (const relation of observed) {
    const pair = [relation.source, relation.target].sort().join('|');
    if (!existingPairs.has(pair) && !combined.has(relation.id)) combined.set(relation.id, relation);
  }
  return [...combined.values()];
}
async function buildGraphModel(app, settings) {
  const scope = cleanFolder(settings.projectFolder);
  const files = app.vault.getMarkdownFiles().filter(f => withinFolder(f.path, scope));
  const nodes = [];
  const relationFiles = [];
  for (const file of files) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter || {};
    if (str(fm.relation_id) || str(fm.node_type) === 'relation') {
      relationFiles.push({ file, fm }); continue;
    }
    const kind = str(fm.node_type);
    const paperId = str(fm.paper_id);
    const isCenter = kind === 'center' || file.basename === 'C00-INSES';
    if (!isCenter && !paperId && !NODE_KINDS.has(kind)) continue;
    const id = paperId || (isCenter ? 'C00' : file.path);
    nodes.push({ id, path: file.path, basename: file.basename,
      title: str(fm.title) || file.basename,
      kind: isCenter ? 'center' : (kind && NODE_KINDS.has(kind) ? kind : 'paper'),
      zoteroKey: str(fm.zotero_key), pdfPath: str(fm.pdf_path || fm.pdf),
      pdfUrl: safeWebUrl(fm.pdf_url),
      sourceUrl: safeWebUrl(fm.source_url || fm.url || fm.URL),
      file,
    });
  }
  const index = buildNodeIndex(nodes);
  const center = nodes.find(n => n.kind === 'center') || nodes[0] || null;
  let overview = [];
  const overviewFile = files.find(f => f.path === settings.overviewPath);
  if (overviewFile && center) {
    overview = parseOverviewRelationships(await app.vault.cachedRead(overviewFile), center, index, overviewFile.path);
  }
  const typed = relationFiles.map(({fm}) => parseTypedRelationship(fm, index)).filter(Boolean);
  const observed = [];
  const existingNodes = new Map(nodes.map(n => [n.path, n]));
  const links = app.metadataCache.resolvedLinks || {};
  for (const [sourcePath, destinations] of Object.entries(links)) {
    const a = existingNodes.get(sourcePath);
    if (!a) continue;
    for (const [targetPath, count] of Object.entries(destinations)) {
      const b = existingNodes.get(targetPath);
      if (!b || a.id === b.id || !count) continue;
      observed.push({
        id: `wikilink:${a.path}->${b.path}`, source: a.id, target: b.id,
        kind: 'wikilink', type: 'unverified_link', status: 'unverified',
        summaryFromSource: `笔记链接到 ${b.basename}；没有附带可核实的学术关系说明。`,
        summaryFromTarget: `${a.basename} 链接了此笔记；这不代表已经证明技术继承或引用关系。`,
        evidence: { note: a.path },
      });
    }
  }
  return { nodes, edges: uniqueRelations(overview, typed, observed), centerId: center?.id || '',
    overviewCount: overview.length, typedCount: typed.length };
}

function initialLayout(nodes, edges, centerId) {
  const positions = new Map();
  if (!nodes.length) return positions;
  const center = nodes.find(n => n.id === centerId) || nodes[0];
  positions.set(center.id, { x: 545, y: 390 });
  const others = nodes.filter(n => n.id !== center.id).sort((a,b) => a.id.localeCompare(b.id));
  // Stable, immediately usable layout; avoid random jitter every time Vault reloads.
  others.forEach((node, i) => {
    const ring = i < 13 ? 0 : i < 31 ? 1 : 2;
    const ringStart = ring === 0 ? 0 : ring === 1 ? 13 : 31;
    const ringSize = ring === 0 ? Math.min(13, others.length) : ring === 1 ? Math.min(18, others.length - 13) : Math.max(1, others.length - 31);
    const local = i - ringStart;
    const angle = -Math.PI / 2 + (2 * Math.PI * local / ringSize) + ring * 0.13;
    const r = [260, 370, 490][ring];
    positions.set(node.id, {x: 545 + Math.cos(angle) * r, y: 390 + Math.sin(angle) * r * 0.86});
  });
  // A few deterministic attraction/repulsion iterations relieve clashes without unstable physics.
  const all = [...nodes];
  const forceIterations = nodes.length <= 100 ? 38 : 0;
  for (let step=0; step<forceIterations; step++) {
    const velocities = new Map(all.map(n=>[n.id,{x:0,y:0}]));
    for(let i=0;i<all.length;i++) for(let j=i+1;j<all.length;j++) {
      const a=positions.get(all[i].id), b=positions.get(all[j].id);
      const dx=a.x-b.x, dy=a.y-b.y, d2=Math.max(200,dx*dx+dy*dy);
      const force=6200/d2;
      const magnitude = Math.sqrt(d2);
      const fx=force*dx/magnitude, fy=force*dy/magnitude;
      velocities.get(all[i].id).x+=fx; velocities.get(all[i].id).y+=fy;
      velocities.get(all[j].id).x-=fx; velocities.get(all[j].id).y-=fy;
    }
    for(const e of edges.filter(x=>x.kind!=='wikilink')) {
      const a=positions.get(e.source), b=positions.get(e.target);
      if(!a||!b) continue;
      const dx=b.x-a.x,dy=b.y-a.y,dist=Math.max(1,Math.hypot(dx,dy));
      const pull=0.009*(dist-275);
      velocities.get(e.source).x+=pull*dx/dist; velocities.get(e.source).y+=pull*dy/dist;
      velocities.get(e.target).x-=pull*dx/dist; velocities.get(e.target).y-=pull*dy/dist;
    }
    for(const node of others) {
      const p=positions.get(node.id), v=velocities.get(node.id);
      p.x=clamp(p.x + clamp(v.x,-7,7),70,1030);
      p.y=clamp(p.y + clamp(v.y,-7,7),70,740);
    }
  }
  return positions;
}
function svgEl(tag, attrs = {}, text = null) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  if (text !== null) element.textContent = String(text);
  return element;
}
function dom(tag, className, parent, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  if (parent) parent.appendChild(element);
  return element;
}
function btn(parent, text, onClick, cls = '') {
  const element = dom('button', `ew-button ${cls}`.trim(), parent, text);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}
function openUrl(url) {
  const safe = safeWebUrl(url);
  if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
}
function statusLabel(status) {
  if (status === 'reviewed') return '声明为已审';
  if (status === 'limited_reviewed') return '有限关系已审';
  return '尚未核验';
}

class EvidenceWeaveView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.model = { nodes: [], edges: [], centerId: '' };
    this.nodeMap = new Map();
    this.positionMap = new Map();
    this.nodeElements = new Map();
    this.edgeElements = new Map();
    this.selectedNodeId = '';
    this.selectedEdgeId = '';
    this.hoverNodeId = '';
    this.hoverEdgeId = '';
    this.searchText = '';
    this.panX = 0; this.panY = 0; this.scale = 1;
    this.readerSeq = 0;
    this.noteCache = new Map();
    this.hoverTimer = null;
    this.restoreTimer = null;
    this.pdfComponent = null;
    this.dragInfo = null;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'EvidenceWeave · 论文证据'; }
  getIcon() { return 'network'; }

  async onOpen() {
    const container = this.containerEl.children[1] || this.containerEl;
    container.empty();
    this.root = dom('div', 'ew-root', container);
    const toolbar = dom('div', 'ew-toolbar', this.root);
    const brand = dom('div', 'ew-brand', toolbar);
    dom('span', 'ew-brand-mark', brand, '✦');
    dom('strong', '', brand, 'EvidenceWeave');
    this.stats = dom('span', 'ew-stats', toolbar, '正在索引 Vault…');
    const search = dom('input', 'ew-search', toolbar);
    search.type = 'search'; search.placeholder = '搜索论文 / P21…';
    search.setAttribute('aria-label', '搜索论文节点');
    search.addEventListener('input', () => { this.searchText = search.value.trim().toLocaleLowerCase(); this.updateFocus(); });
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const matched = this.model.nodes.find(n => [n.basename,n.title,n.id].some(x=>x.toLocaleLowerCase().includes(this.searchText)));
      if (matched) this.pinNode(matched.id);
    });
    this.toggleButton = btn(toolbar, '显示未核双链', async () => {
      this.plugin.settings.showUnverifiedLinks = !this.plugin.settings.showUnverifiedLinks;
      await this.plugin.saveSettings();
      this.renderGraph();
    });
    btn(toolbar, '重置视图', () => this.resetView());
    btn(toolbar, '刷新', () => this.reload());

    const workbench = dom('div', 'ew-workbench', this.root);
    this.graphPane = dom('section', 'ew-graph-pane', workbench);
    this.graphPane.setAttribute('aria-label','科研关系图谱');
    const hint = dom('div', 'ew-graph-hint', this.graphPane);
    dom('strong', '', hint, 'Hover · 阅读关系');
    dom('span', '', hint, '悬停高亮邻边并显示解释；点击锁定；双击打开笔记；滚轮缩放。');
    this.svg = svgEl('svg', { viewBox:'0 0 1100 800', class:'ew-svg', role:'img', 'aria-label':'Interactive evidence graph' });
    this.graphPane.appendChild(this.svg);
    this.stage = svgEl('g', {class:'ew-stage'});
    this.svg.appendChild(this.stage);
    this.graphFooter = dom('div', 'ew-graph-footer', this.graphPane);
    dom('span', 'ew-legend-item', this.graphFooter, '● 有证据关系');
    dom('span', 'ew-legend-item', this.graphFooter, '┄ 仅笔记双链（未核验）');

    this.resizer = dom('div', 'ew-resize-handle', workbench);
    this.resizer.setAttribute('aria-label', '调整论文阅读区域宽度');
    this.reader = dom('aside', 'ew-reader', workbench);
    this.reader.setAttribute('aria-label','论文与证据阅读面板');
    this.reader.style.width = `${this.plugin.settings.graphReaderWidth}%`;
    this.readerHeader = dom('div', 'ew-reader-header', this.reader);
    this.pdfPanel = dom('div', 'ew-pdf-panel', this.reader);
    this.evidencePanel = dom('div', 'ew-evidence-panel', this.reader);
    this.relationsPanel = dom('div', 'ew-relations-panel', this.reader);
    this.installInteractions(workbench);
    await this.reload();
  }

  async onClose() {
    clearTimeout(this.hoverTimer);
    clearTimeout(this.restoreTimer);
    this.disposePdf();
    this.readerSeq++;
    this.noteCache.clear();
  }

  async reload() {
    this.stats.textContent = '读取本地笔记…';
    const before = this.selectedNodeId;
    try {
      this.noteCache.clear();
      this.model = await buildGraphModel(this.app, this.plugin.settings);
      this.nodeMap = new Map(this.model.nodes.map(n => [n.id,n]));
      this.selectedNodeId = this.nodeMap.has(before) ? before : this.model.centerId;
      this.selectedEdgeId = '';
      this.hoverNodeId = ''; this.hoverEdgeId = '';
      this.positionMap = initialLayout(this.model.nodes, this.model.edges, this.model.centerId);
      this.renderGraph();
      const validated = this.model.edges.filter(e=>e.kind!=='wikilink').length;
      this.stats.textContent = `${this.model.nodes.length} 节点 · ${validated} 条证据关系`;
      if (this.selectedNodeId) await this.showReader(this.selectedNodeId, null);
      else this.renderEmptyReader();
    } catch (err) {
      this.stats.textContent = '索引失败';
      this.renderEmptyReader('读取 Vault 失败。检查 INSES 路径、M00 文件和插件设置。');
      console.error('[EvidenceWeave] Could not build graph', err);
      new Notice('EvidenceWeave: 读取笔记失败，请查看控制台。');
    }
  }

  resetView() {
    this.panX=0; this.panY=0; this.scale=1;
    this.updateTransform();
  }
  updateTransform() {
    this.stage.setAttribute('transform', `translate(${this.panX} ${this.panY}) scale(${this.scale})`);
  }
  visibleEdges() { return this.model.edges.filter(e=>this.plugin.settings.showUnverifiedLinks || e.kind !== 'wikilink'); }

  renderGraph() {
    this.stage.replaceChildren();
    this.nodeElements.clear(); this.edgeElements.clear();
    this.toggleButton.classList.toggle('is-active', this.plugin.settings.showUnverifiedLinks);
    this.toggleButton.setAttribute('aria-pressed', String(this.plugin.settings.showUnverifiedLinks));
    const edgeLayer = svgEl('g', {class:'ew-edges'});
    const labelLayer = svgEl('g', {class:'ew-edge-labels'});
    const nodeLayer = svgEl('g', {class:'ew-nodes'});
    this.stage.append(edgeLayer,labelLayer,nodeLayer);
    this.labelLayer = labelLayer;
    for (const edge of this.visibleEdges()) {
      const source = this.positionMap.get(edge.source), target = this.positionMap.get(edge.target);
      if (!source || !target) continue;
      const group = svgEl('g', {class:`ew-edge ${edge.kind === 'wikilink' ? 'is-wikilink' : 'is-evidence'}`});
      const line = svgEl('line', {x1:source.x,y1:source.y,x2:target.x,y2:target.y});
      line.classList.add('ew-edge-stroke');
      const hit = svgEl('line', {x1:source.x,y1:source.y,x2:target.x,y2:target.y});
      hit.classList.add('ew-edge-hit');
      group.append(line,hit);
      const title = svgEl('title', {}, `${edge.type}: ${edge.summaryFromSource}`);
      group.appendChild(title);
      group.addEventListener('pointerenter', () => {
        this.hoverEdgeId = edge.id;
        this.hoverNodeId = '';
        clearTimeout(this.hoverTimer);
        clearTimeout(this.restoreTimer);
        this.updateFocus();
      });
      group.addEventListener('pointerleave', () => {
        if (this.hoverEdgeId === edge.id) this.hoverEdgeId = '';
        this.updateFocus();
      });
      group.addEventListener('click', (event) => { event.stopPropagation(); this.pinEdge(edge.id); });
      edgeLayer.appendChild(group);
      this.edgeElements.set(edge.id, {group,line,hit,edge});
    }
    for (const node of this.model.nodes) {
      const pos = this.positionMap.get(node.id);
      if (!pos) continue;
      const group = svgEl('g', {class:`ew-node ew-kind-${node.kind}`, tabindex:'0', role:'button'});
      const circle = svgEl('circle', {r:node.kind === 'center' ? 16 : node.kind === 'paper' ? 9.5 : 11, cx:0,cy:0});
      const name = svgEl('text', {x:0,y:node.kind==='center'?31:25,'text-anchor':'middle'}, nodeLabel(node));
      group.append(circle,name);
      group.setAttribute('transform',`translate(${pos.x} ${pos.y})`);
      group.setAttribute('aria-label', `论文节点：${node.title}。Enter 选中；双击打开原笔记。`);
      group.appendChild(svgEl('title',{},node.title));
      group.addEventListener('pointerenter',()=>this.hoverNode(node.id));
      group.addEventListener('pointerleave',()=>this.exitHoverNode(node.id));
      group.addEventListener('click',(event)=>{
        event.stopPropagation();
        if (this.dragInfo?.moved) return;
        this.pinNode(node.id);
      });
      group.addEventListener('dblclick',event=>{event.stopPropagation();this.openNote(node.path);});
      group.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){event.preventDefault(); this.pinNode(node.id);}
      });
      nodeLayer.appendChild(group);
      this.nodeElements.set(node.id,{group,circle,name,node});
    }
    this.updateTransform();
    this.updateFocus();
    if (!this.model.nodes.length) {
      const text = svgEl('text', {x:550,y:400,'text-anchor':'middle',class:'ew-blank-graph'},
        '未发现论文节点，请在设置中检查项目目录。');
      this.stage.appendChild(text);
    }
  }

  hoverNode(id) {
    clearTimeout(this.restoreTimer);
    clearTimeout(this.hoverTimer);
    this.hoverNodeId = id; this.hoverEdgeId = '';
    this.updateFocus();
    // Delayed paper preview on hover; avoids reading/loading a PDF for each pass-through.
    if (id !== this.selectedNodeId) {
      this.hoverTimer = setTimeout(() => {
        if (this.hoverNodeId === id) this.showReader(id,null,true);
      }, 430);
    }
  }
  exitHoverNode(id) {
    if (this.hoverNodeId !== id) return;
    this.hoverNodeId = '';
    clearTimeout(this.hoverTimer);
    this.updateFocus();
    this.restoreTimer = setTimeout(() => {
      if (!this.hoverNodeId && this.selectedNodeId) this.showReader(this.selectedNodeId,this.getPinnedEdge(),false);
    }, 550);
  }
  getPinnedEdge() { return this.model.edges.find(e=>e.id===this.selectedEdgeId) || null; }
  pinNode(id) {
    if (!this.nodeMap.has(id)) return;
    clearTimeout(this.restoreTimer); clearTimeout(this.hoverTimer);
    this.selectedNodeId = id; this.selectedEdgeId = '';
    this.updateFocus();
    void this.showReader(id,null,false);
  }
  pinEdge(id) {
    const edge = this.model.edges.find(e=>e.id===id);
    if (!edge) return;
    clearTimeout(this.restoreTimer); clearTimeout(this.hoverTimer);
    this.selectedEdgeId=id;
    const focused = this.hoverNodeId || this.selectedNodeId;
    // Prefer the paper endpoint over the central survey/overview node for PDF preview.
    const right = this.nodeMap.get(edge.target), left = this.nodeMap.get(edge.source);
    const paper = right?.kind==='paper' ? right : left?.kind==='paper' ? left : right || left;
    if (paper) this.selectedNodeId=paper.id;
    this.hoverNodeId=''; this.hoverEdgeId='';
    this.updateFocus();
    if (paper) void this.showReader(paper.id,edge,false,focused);
  }

  updateFocus() {
    const focusId = this.hoverNodeId || this.selectedNodeId;
    const selectedEdge = this.hoverEdgeId || this.selectedEdgeId;
    const edges = this.visibleEdges();
    const neighbors = new Set([focusId]);
    const connected = edges.filter(e=>e.source===focusId||e.target===focusId);
    for(const e of connected){neighbors.add(e.source);neighbors.add(e.target);}
    if(selectedEdge){
      const e=edges.find(item=>item.id===selectedEdge);
      if(e){neighbors.add(e.source);neighbors.add(e.target);}
    }
    const matches = this.searchText ? new Set(this.model.nodes.filter(n=>
      [n.id,n.title,n.basename].some(field=>field.toLocaleLowerCase().includes(this.searchText))
    ).map(n=>n.id)) : null;
    for(const [id,{group}] of this.nodeElements){
      const dimByFocus=!!focusId&&!neighbors.has(id);
      const dimBySearch=!!matches&&!matches.has(id)&&id!==focusId;
      group.classList.toggle('is-dimmed', dimByFocus||dimBySearch);
      group.classList.toggle('is-focused', id===focusId);
      group.classList.toggle('is-adjacent', id!==focusId&&neighbors.has(id));
      group.classList.toggle('is-search-match', !!matches&&matches.has(id));
    }
    for(const [id,{group,edge}] of this.edgeElements){
      const near=edge.source===focusId||edge.target===focusId;
      group.classList.toggle('is-dimmed', !near && id!==selectedEdge);
      group.classList.toggle('is-highlighted', near);
      group.classList.toggle('is-selected', id===selectedEdge);
    }
    this.renderEdgeSummaries(this.hoverNodeId || this.selectedNodeId);
  }
  renderEdgeSummaries(focus) {
    this.labelLayer.replaceChildren();
    if (!focus) return;
    const connected = this.visibleEdges().filter(e=>e.source===focus||e.target===focus);
    connected.forEach((e,i)=>{
      const a=this.positionMap.get(e.source), b=this.positionMap.get(e.target);
      if(!a||!b) return;
      const labelText=shorten(directedSummary(e,focus),63);
      const x=a.x*0.45+b.x*0.55;
      const y=a.y*0.45+b.y*0.55;
      const dx=b.x-a.x,dy=b.y-a.y,len=Math.max(1,Math.hypot(dx,dy));
      const normalX=-dy/len,normalY=dx/len;
      const side = i%2===0?1:-1;
      const bx=x+normalX*(14+7*(i%3))*side;
      const by=y+normalY*(14+7*(i%3))*side;
      const width=clamp(labelText.length*6.6+20,95,418);
      const label=svgEl('g',{class:`ew-summary-label ${e.kind==='wikilink'?'is-weak':''}`});
      label.appendChild(svgEl('rect',{x:bx-width/2,y:by-15,width,height:29,rx:6}));
      label.appendChild(svgEl('text',{x:bx,y:by+4,'text-anchor':'middle'},labelText));
      label.appendChild(svgEl('title',{},directedSummary(e,focus)));
      label.addEventListener('pointerenter',()=>{this.hoverEdgeId=e.id; this.updateEdgeLabelFocus();});
      label.addEventListener('pointerleave',()=>{this.hoverEdgeId=''; this.updateEdgeLabelFocus();});
      label.addEventListener('click',(event)=>{event.stopPropagation();this.pinEdge(e.id);});
      this.labelLayer.appendChild(label);
    });
    this.updateEdgeLabelFocus();
  }
  updateEdgeLabelFocus() {
    // Keep pointer-hover styling contained; do not recursively rebuild labels.
    this.labelLayer.querySelectorAll('.ew-summary-label').forEach(el=>el.classList.remove('is-hovered'));
    const current=this.labelLayer.querySelector('.ew-summary-label:hover');
    if(current) current.classList.add('is-hovered');
  }
  installInteractions(workbench) {
    const svg=this.svg;
    const viewPoint=(event)=>{
      const bounds=svg.getBoundingClientRect();
      return {x:(event.clientX-bounds.left)*1100/Math.max(1,bounds.width),
        y:(event.clientY-bounds.top)*800/Math.max(1,bounds.height)};
    };
    svg.addEventListener('wheel', event=>{
      event.preventDefault();
      const p=viewPoint(event);
      const beforeX=(p.x-this.panX)/this.scale, beforeY=(p.y-this.panY)/this.scale;
      this.scale=clamp(this.scale*(event.deltaY<0?1.1:0.91),0.47,3.6);
      this.panX=p.x-beforeX*this.scale; this.panY=p.y-beforeY*this.scale;
      this.updateTransform();
    },{passive:false});
    svg.addEventListener('pointerdown',event=>{
      if(event.button!==0) return;
      const nodeElement=event.target.closest('.ew-node');
      const id=nodeElement ? [...this.nodeElements].find(([,o])=>o.group===nodeElement)?.[0] : null;
      const point=viewPoint(event);
      this.dragInfo={id,mode:id?'node':'pan',moved:false,from:point,
        startPanX:this.panX,startPanY:this.panY,
        startPosition:id?{...this.positionMap.get(id)}:null};
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove',event=>{
      const d=this.dragInfo;
      if(!d) return;
      const point=viewPoint(event),dx=point.x-d.from.x,dy=point.y-d.from.y;
      if(Math.abs(dx)+Math.abs(dy)>5)d.moved=true;
      if(!d.moved) return;
      if(d.mode==='pan'){
        this.panX=d.startPanX+dx; this.panY=d.startPanY+dy;this.updateTransform();
      }else if(d.id){
        const pos=this.positionMap.get(d.id);
        pos.x=d.startPosition.x+dx/this.scale;
        pos.y=d.startPosition.y+dy/this.scale;
        this.moveNodeElement(d.id);
      }
    });
    const end=()=>{
      const wasMoved=this.dragInfo?.moved;
      const selected=this.dragInfo?.id;
      this.dragInfo=null;
      if(wasMoved && selected) this.updateFocus();
    };
    svg.addEventListener('pointerup',end);
    svg.addEventListener('pointercancel',end);
    this.resizer.addEventListener('pointerdown',event=>{
      if(event.button!==0) return;
      const box=workbench.getBoundingClientRect();
      this.resizer.setPointerCapture(event.pointerId);
      const onMove=(ev)=>{
        const pct=100*(box.right-ev.clientX)/Math.max(1,box.width);
        this.reader.style.width=`${clamp(pct,26,70)}%`;
      };
      const onUp=async()=>{
        this.resizer.removeEventListener('pointermove',onMove);
        this.resizer.removeEventListener('pointerup',onUp);
        this.resizer.removeEventListener('pointercancel',onUp);
        this.plugin.settings.graphReaderWidth=parseFloat(this.reader.style.width);
        await this.plugin.saveSettings();
      };
      this.resizer.addEventListener('pointermove',onMove);
      this.resizer.addEventListener('pointerup',onUp);
      this.resizer.addEventListener('pointercancel',onUp);
    });
  }
  moveNodeElement(id) {
    const node=this.nodeElements.get(id),position=this.positionMap.get(id);
    if(!node||!position)return;
    node.group.setAttribute('transform',`translate(${position.x} ${position.y})`);
    for(const {edge,line,hit} of this.edgeElements.values()){
      if(edge.source!==id&&edge.target!==id)continue;
      const a=this.positionMap.get(edge.source),b=this.positionMap.get(edge.target);
      for(const el of [line,hit]){
        el.setAttribute('x1',a.x);el.setAttribute('y1',a.y);
        el.setAttribute('x2',b.x);el.setAttribute('y2',b.y);
      }
    }
    this.renderEdgeSummaries(this.hoverNodeId||this.selectedNodeId);
  }

  async readPaper(node) {
    if (this.noteCache.has(node.path)) return this.noteCache.get(node.path);
    const file=this.app.vault.getAbstractFileByPath(node.path);
    if(!file||file.extension!=='md') return '';
    const content=await this.app.vault.cachedRead(file);
    this.noteCache.set(node.path,content);
    return content;
  }
  localPdf(node) {
    const requested=node.pdfPath.replace(/^\[\[|\]\]$/g,'').split('#')[0];
    if(!requested)return null;
    const raw=this.app.vault.getAbstractFileByPath(requested);
    if(raw?.extension==='pdf')return raw;
    const linked=this.app.metadataCache.getFirstLinkpathDest(requested,node.path);
    return linked?.extension==='pdf'?linked:null;
  }
  async resolveEvidence(relation) {
    const evidence={...relation.evidence};
    if (evidence.note && evidence.block) {
      const file=this.app.vault.getAbstractFileByPath(evidence.note);
      if(file?.extension==='md'){
        const source=await this.app.vault.cachedRead(file);
        const extra=extractLegacyEvidence(source,evidence.block);
        // Existing structured evidence wins over fallback extraction.
        for(const [key,value] of Object.entries(extra)) if(!evidence[key]&&value)evidence[key]=value;
      }
    }
    return evidence;
  }
  renderEmptyReader(message='悬停或点击论文节点，开始阅读原文与核对关系证据。') {
    this.readerHeader.replaceChildren();this.pdfPanel.replaceChildren();
    this.evidencePanel.replaceChildren();this.relationsPanel.replaceChildren();
    dom('div','ew-empty',this.pdfPanel,message);
  }
  disposePdf(){
    if(this.pdfComponent){
      try {this.removeChild(this.pdfComponent);} catch {this.pdfComponent.unload?.();}
      this.pdfComponent=null;
    }
  }
  async showReader(id, relation = null, transient = false, viewpoint = '') {
    const node=this.nodeMap.get(id);
    if(!node)return;
    const seq=++this.readerSeq;
    let note=''; let evidence={};
    try {
      note=await this.readPaper(node);
      if(relation) evidence=await this.resolveEvidence(relation);
    }catch(err){console.warn('[EvidenceWeave] Read paper/evidence failed',err);}
    if(seq!==this.readerSeq)return;
    this.disposePdf();
    this.readerHeader.replaceChildren();this.pdfPanel.replaceChildren();
    this.evidencePanel.replaceChildren();this.relationsPanel.replaceChildren();
    const title=dom('div','ew-paper-heading',this.readerHeader);
    dom('div','ew-overline',title,transient?'悬停预览 · 点击锁定':'论文阅读 · 证据核对');
    dom('h3','',title,node.title);
    if(node.zoteroKey)dom('div','ew-subline',title,`Zotero · ${node.zoteroKey}`);
    const actions=dom('div','ew-actions',this.readerHeader);
    btn(actions,'打开笔记',()=>this.openNote(node.path));
    if(node.zoteroKey){
      btn(actions,'Zotero',()=>{
        // Obsidian already has the user's item key; no Zotero API/MCP required.
        const uri=`zotero://select/library/items/${encodeURIComponent(node.zoteroKey)}`;
        window.open(uri,'_blank');
      });
    }
    const pdf=this.localPdf(node);
    const remote=evidence.pdfUrl||node.pdfUrl||discoverPdfUrl(note,node);
    const url=remote || node.sourceUrl;
    if(url)btn(actions,remote?'浏览器打开 PDF':'论文来源',()=>openUrl(url));
    const viewport=dom('div','ew-pdf-viewport',this.pdfPanel);
    const caption=dom('div','ew-viewport-title',viewport,
      pdf?'Vault 内 PDF · Obsidian 内置阅读器':remote?'在线 PDF · 若被出版社限制，请点击浏览器打开':'原文阅读区');
    if(pdf){
      const embed=dom('div','ew-native-pdf',viewport);
      try {
        const { Component }=require('obsidian');
        const child=new Component();
        this.addChild(child); this.pdfComponent=child;
        const page=Number(evidence.page);
        const reference=`${pdf.path}${Number.isInteger(page)&&page>0?'#page='+page:''}`;
        await MarkdownRenderer.render(this.app,`![[${reference}]]`,embed,node.path,child);
      }catch(err){
        console.warn('[EvidenceWeave] Native PDF embed failed',err);
        dom('p','ew-empty',viewport,'内嵌 PDF 无法渲染。请在 Obsidian 文件浏览器打开该 PDF。');
      }
    } else if(remote&&this.plugin.settings.previewRemotePdfs){
      const iframe=dom('iframe','ew-remote-pdf',viewport);
      iframe.title=`PDF: ${node.title}`;
      iframe.loading='lazy';iframe.referrerPolicy='no-referrer';
      const pdfUrl=new URL(remote);
      if(evidence.page)pdfUrl.hash=`page=${evidence.page}`;
      // A remote PDF is explicitly user-authored in the local note. Never eval or inject its content.
      iframe.src=pdfUrl.href;
      dom('div','ew-pdf-help',viewport,'在线 PDF 若空白，通常是出版商禁止内嵌；可使用上方“浏览器打开 PDF”。');
    } else if(remote) {
      dom('div','ew-empty',viewport,'已找到在线 PDF。设置中启用在线预览，或点击上方浏览器链接查看。');
    } else {
      dom('div','ew-empty',viewport,'未找到本地 pdf_path 或可直接预览的 PDF 链接。');
      if(node.sourceUrl)btn(viewport,'打开正式论文来源',()=>openUrl(node.sourceUrl));
    }
    if(seq!==this.readerSeq)return;
    this.renderEvidence(node,relation,evidence,viewpoint||node.id);
    this.renderRelations(node);
  }
  renderEvidence(node, relation, evidence, viewpoint) {
    const section=dom('section','ew-evidence-card',this.evidencePanel);
    if (!relation) {
      dom('div','ew-section-heading',section,'关系证据');
      dom('p','ew-muted',section,'点击图中的连线或下方关系条目，查看关系依据、原文短引及 PDF 页码。');
      return;
    }
    const header=dom('div','ew-evidence-top',section);
    dom('strong','',header,relation.id);
    dom('span',`ew-status ew-status-${relation.status}`,header,statusLabel(relation.status));
    dom('div','ew-relationship-type',section,`关系类型：${relation.type} · ${relation.kind==='wikilink'?'未经审查的笔记双链':'结构化或已整理的文献关系'}`);
    dom('p','ew-evidence-summary',section,directedSummary(relation,viewpoint));
    if(evidence.sourceNote)dom('p','ew-evidence-location',section,`引用关系整理端：${evidence.sourceNote}`);
    if(evidence.note)dom('p','ew-evidence-location',section,`被引论文证据端：${evidence.note}${evidence.block?'#^'+evidence.block:''}`);
    if(evidence.section)dom('p','ew-evidence-location',section,evidence.section);
    if(evidence.page)dom('p','ew-evidence-location',section,`PDF 第 ${evidence.page} 页（来源文档记录，尚需人工核对版本）`);
    if(evidence.quote){
      dom('div','ew-evidence-quote-label',section,'原文短引（来自笔记记录）');
      dom('blockquote','ew-quote',section,evidence.quote);
    }
    if(relation.status !== 'reviewed') {
      dom('p','ew-review-warning',section,'此状态不代表已核验全部实验配置、论文结论或技术继承。');
    }
    const buttons=dom('div','ew-evidence-actions',section);
    if(evidence.note){
      btn(buttons,'跳到证据笔记',()=>this.openEvidence(evidence.note,evidence.block));
    }
    if(evidence.pdfUrl){
      const candidate=new URL(evidence.pdfUrl);
      if(evidence.page)candidate.hash=`page=${evidence.page}`;
      btn(buttons,'在浏览器核对原文页',()=>openUrl(candidate.href));
    }
  }
  renderRelations(node) {
    const head=dom('div','ew-section-heading',this.relationsPanel,'从当前论文视角看关联');
    const related=this.visibleEdges().filter(e=>e.source===node.id||e.target===node.id);
    dom('span','ew-relations-count',head,`${related.length}`);
    if(!related.length){dom('p','ew-muted',this.relationsPanel,'此节点尚无已记录的关系边。');return;}
    for(const relation of related){
      const other=this.nodeMap.get(relation.source===node.id?relation.target:relation.source);
      const card=dom('button','ew-relation-item',this.relationsPanel);
      card.type='button';
      if(relation.id===this.selectedEdgeId)card.classList.add('is-active');
      const headline=dom('div','ew-relation-head',card);
      dom('strong','',headline,other?.basename||'未知节点');
      dom('small','',headline,relation.kind==='wikilink'?'未核双链':relation.type);
      dom('p','',card,directedSummary(relation,node.id));
      card.addEventListener('click',()=>this.pinEdge(relation.id));
    }
  }
  async openNote(path) {
    const file=this.app.vault.getAbstractFileByPath(path);
    if(file?.extension!=='md')return;
    const leaf=this.app.workspace.getLeaf('tab');
    await leaf.openFile(file);
  }
  async openEvidence(path,block) {
    const target=block?`${path}#^${block.replace(/^\^/,'')}`:path;
    await this.app.workspace.openLinkText(target,path,'tab');
  }
}

class EvidenceWeaveSettingsTab extends PluginSettingTab {
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    const {containerEl}=this;containerEl.empty();
    containerEl.createEl('h2',{text:'EvidenceWeave · 笔记与 PDF 工作台'});
    containerEl.createEl('p',{text:'仅读取本地 Vault，不连接 MCP、不上传文件，也不会改动你的论文笔记。'});
    new Setting(containerEl).setName('项目目录')
      .setDesc('默认 INSES；留空则索引整个 Vault 的已标记节点。')
      .addText(text=>text.setPlaceholder('INSES').setValue(this.plugin.settings.projectFolder)
        .onChange(async value=>{this.plugin.settings.projectFolder=cleanFolder(value);await this.plugin.saveSettings();}));
    new Setting(containerEl).setName('已有关系总览笔记')
      .setDesc('读取 M00 中带 R-Pxx-01 证据锚点的一行说明；没有时可使用类型化关系笔记。')
      .addText(text=>text.setValue(this.plugin.settings.overviewPath)
        .onChange(async value=>{this.plugin.settings.overviewPath=str(value);await this.plugin.saveSettings();}));
    new Setting(containerEl).setName('显示未经核验的普通双链')
      .setDesc('将 Obsidian 双链绘成灰色虚线；绝不作为已证明的论文关系。')
      .addToggle(toggle=>toggle.setValue(this.plugin.settings.showUnverifiedLinks)
        .onChange(async value=>{this.plugin.settings.showUnverifiedLinks=value;await this.plugin.saveSettings();}));
    new Setting(containerEl).setName('在线 PDF 预览')
      .setDesc('打开/悬停选中含 PDF URL 的论文时，会连接来源网站；某些出版社不允许内嵌。')
      .addToggle(toggle=>toggle.setValue(this.plugin.settings.previewRemotePdfs)
        .onChange(async value=>{this.plugin.settings.previewRemotePdfs=value;await this.plugin.saveSettings();}));
    containerEl.createEl('p',{text:'修改目录或关系来源后，回到 EvidenceWeave 点击「刷新」即可。'});
  }
}

class EvidenceWeavePlugin extends Plugin {
  async onload(){
    this.settings=Object.assign({},DEFAULT_SETTINGS,await this.loadData());
    this.registerView(VIEW_TYPE,leaf=>new EvidenceWeaveView(leaf,this));
    this.addRibbonIcon('network','Open EvidenceWeave',()=>this.activateView());
    this.addCommand({id:'open-evidence-graph',name:'Open EvidenceWeave paper understanding graph',callback:()=>this.activateView()});
    this.addSettingTab(new EvidenceWeaveSettingsTab(this.app,this));
  }
  onunload(){this.app.workspace.detachLeavesOfType(VIEW_TYPE);}
  async saveSettings(){await this.saveData(this.settings);}
  async activateView(){
    const {workspace}=this.app;
    let leaf=workspace.getLeavesOfType(VIEW_TYPE)[0];
    if(!leaf){leaf=workspace.getLeaf('tab');await leaf.setViewState({type:VIEW_TYPE,active:true});}
    workspace.revealLeaf(leaf);
  }
}

module.exports = EvidenceWeavePlugin;
module.exports.default = EvidenceWeavePlugin;
module.exports._test = {
  safeWebUrl, buildNodeIndex, parseOverviewRelationships, parseTypedRelationship,
  extractLegacyEvidence, discoverPdfUrl, directedSummary, uniqueRelations,
  initialLayout, buildGraphModel, edgeReviewStatus, stripStatus,
};