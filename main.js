// EvidenceWeave 0.3.0 - native Graph View enhancement, generated from src/.
// Reused EvidenceWeave local Vault relationship parsing and conflict-safe Markdown patching.
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
function validateSummary(value) {
  const summary = str(value);
  if (!summary || summary.length > 400 || /[\r\n\u0000-\u001f\u007f]/u.test(summary)) {
    throw new Error('关系说明必须是一句 1–400 字的单行文字。');
  }
  return summary;
}
function splitLinesPreservingNewlines(content) {
  return content.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) || [];
}
function textWithoutEol(line) { return line.replace(/\r\n$|[\r\n]$/u, ''); }
function endOfLine(line) { return line.match(/\r\n$|[\r\n]$/u)?.[0] || ''; }
function isOverviewLine(line, relationId) {
  const match = textWithoutEol(line).match(/^\s*-\s*\[\[([^|\]]+)\|[^\]]+\]\]\s*[：:]\s*.+$/u);
  return !!match && match[1].endsWith(`#^${relationId}`);
}
function splitOverviewLine(line) {
  const match = textWithoutEol(line).match(/^(\s*-\s*\[\[[^|\]]+\|[^\]]+\]\]\s*[：:]\s*)(.+)$/u);
  if (!match) throw new Error('源笔记中的关系行格式发生变化。');
  return { prefix: match[1], summary: stripStatus(match[2]) };
}
const REVERSE_PREFIX = '  - **被引视角**：';
function reverseSummaryFromLine(line) {
  return textWithoutEol(line).match(/^\s{2,}-\s*\*\*被引视角\*\*\s*[：:]\s*(.+)$/u)?.[1]?.trim() || '';
}
function patchOverviewSummary(content, relation, viewpoint, newText) {
  const summary = validateSummary(newText);
  if (!relation || relation.kind !== 'overview' || !relation.storage?.sourceLine) {
    throw new Error('只有带来源的关系说明才能保存。');
  }
  const rows = splitLinesPreservingNewlines(content);
  const matches = rows.map((line, i) => isOverviewLine(line, relation.id) ? i : -1).filter(i => i >= 0);
  if (matches.length !== 1) throw new Error('关系编号不存在或重复，已阻止写入。');
  const i = matches[0], oldLine = rows[i];
  if (textWithoutEol(oldLine) !== relation.storage.sourceLine) {
    throw new Error('关系源文字已变化，请刷新后重新编辑，避免覆盖同步修改。');
  }
  const {prefix, summary: original} = splitOverviewLine(oldLine);
  const eol = endOfLine(oldLine) || (content.includes('\r\n') ? '\r\n' : '\n');
  if (viewpoint === relation.source) {
    if (original !== relation.summaryFromSource) throw new Error('关系说明与当前笔记版本不一致。');
    rows[i] = `${prefix}${summary} 状态：用户修改待复核。${endOfLine(oldLine)}`;
  } else if (viewpoint === relation.target) {
    // Keep both viewpoints visible in M00; the indented line is ordinary Markdown.
    rows[i] = `${prefix}${original} 状态：用户修改待复核。${endOfLine(oldLine)}`;
    const existing = i + 1 < rows.length ? reverseSummaryFromLine(rows[i + 1]) : '';
    if (relation.storage.reverseLine) {
      if (!existing || textWithoutEol(rows[i + 1]) !== relation.storage.reverseLine) {
        throw new Error('反向说明已被其他编辑改变，请刷新后重试。');
      }
      rows[i + 1] = `${REVERSE_PREFIX}${summary}${endOfLine(rows[i + 1])}`;
    } else {
      if (existing) throw new Error('出现了新的反向说明，请刷新后重试。');
      if (!endOfLine(oldLine)) rows[i] += eol;
      rows.splice(i + 1, 0, `${REVERSE_PREFIX}${summary}${endOfLine(oldLine) || eol}`);
    }
  } else throw new Error('关系视角无效。');
  return rows.join('');
}
function patchTypedSummary(content, relation, viewpoint, newText, parseYamlFn) {
  const summary = validateSummary(newText);
  if (relation?.kind !== 'typed' || !relation.storage?.note || typeof parseYamlFn !== 'function') {
    throw new Error('无法确认关系笔记的来源与格式。');
  }
  const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/u);
  if (!fmMatch) throw new Error('关系笔记缺少标准 YAML frontmatter。');
  const frontmatter = parseYamlFn(fmMatch[2]);
  if (!frontmatter || str(frontmatter.relation_id) !== relation.id ||
      str(frontmatter.source || frontmatter.source_id) !== relation.storage.sourceKey ||
      str(frontmatter.target || frontmatter.target_id) !== relation.storage.targetKey) {
    throw new Error('关系编号或端点已变化，请刷新后再保存。');
  }
  const key = viewpoint === relation.source ? 'summary_from_source' :
    viewpoint === relation.target ? 'summary_from_target' : null;
  if (!key) throw new Error('关系视角无效。');
  const lines = fmMatch[2].split(/\r?\n/u);
  const fieldIndex = lines.map((l,i) => new RegExp(`^${key}\\s*:`,'u').test(l) ? i : -1).filter(i => i>=0);
  if (fieldIndex.length !== 1 || /:\s*[>|]/u.test(lines[fieldIndex[0]])) {
    throw new Error('此 YAML 字段不是可安全更新的单行格式，请在笔记中编辑。');
  }
  if (str(frontmatter[key]) !== directedSummary(relation, viewpoint)) {
    throw new Error('当前视角的文字已变化，已阻止覆盖。');
  }
  lines[fieldIndex[0]] = `${key}: ${JSON.stringify(summary)}`; // JSON quoted strings are valid YAML scalars.
  const statusIndexes = lines.map((l,i)=>/^review_status\s*:/u.test(l)?i:-1).filter(i=>i>=0);
  if (statusIndexes.length > 1) throw new Error('review_status 出现重复字段。');
  if (statusIndexes.length) lines[statusIndexes[0]] = 'review_status: unverified';
  else lines.push('review_status: unverified');
  const updated = lines.join(fmMatch[2].includes('\r\n') ? '\r\n' : '\n');
  return fmMatch[1] + updated + fmMatch[3] + content.slice(fmMatch[0].length);
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
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
    const reverseLine = lines[i + 1] || '';
    const reverse = reverseSummaryFromLine(reverseLine);
    result.push({
      id: anchorMatch[1], source: sourceNode.id, target: dest.id,
      type: 'citation_context', kind: 'overview',
      status: /状态[:：]\s*有限关系已审/u.test(match[2]) ? 'limited_reviewed' : 'unverified',
      summaryFromSource: description,
      summaryFromTarget: reverse || `该文献在 ${sourceNode.basename} 中的作用：${description}`,
      evidence: { note: dest.path, block: anchorMatch[1], sourceNote: overviewPath },
      storage: {kind:'overview',note:overviewPath,sourceLine:line,
        reverseLine:reverse?reverseLine:null},
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
  const typed = relationFiles.map(({file,fm}) => {
    const relation = parseTypedRelationship(fm, index);
    if (relation) relation.storage = {kind:'typed',note:file.path,
      sourceKey:str(fm.source || fm.source_id),targetKey:str(fm.target || fm.target_id)};
    return relation;
  }).filter(Boolean);
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



/* Pure geometry for inline native graph annotations. */
'use strict';
function placePdfByNode(point, viewport, desiredWidth = 330, desiredHeight = 460, padding = 12) {
  const w = Math.max(0, viewport.width || 0), h = Math.max(0, viewport.height || 0);
  if (w < 300 || h < 170 || !point) return null;
  const width = Math.min(desiredWidth, Math.max(235, w - 2 * padding));
  const height = Math.min(desiredHeight, Math.max(145, h - 2 * padding));
  const gap = 28;
  const rightRoom = w - point.x - gap - padding;
  const leftRoom = point.x - gap - padding;
  const preferred = rightRoom >= width || rightRoom >= leftRoom ? 'right' : 'left';
  const x = preferred === 'right' ? point.x + gap : point.x - gap - width;
  return {
    side: preferred,
    x: Math.max(padding, Math.min(w - width - padding, x)),
    y: Math.max(padding, Math.min(h - height - padding, point.y - 42)),
    width, height,
  };
}
function readableEdgeAngle(dx,dy) {
  let angle = Math.atan2(dy,dx);
  if (angle > Math.PI/2) angle -= Math.PI;
  if (angle < -Math.PI/2) angle += Math.PI;
  return angle;
}
function labelPosition(a,b,ratio=0.52) {
  if (!a || !b) return null;
  return {x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio,
    angle:readableEdgeAngle(b.x-a.x,b.y-a.y),
    length:Math.hypot(b.x-a.x,b.y-a.y)};
}


/* Native Graph renderer adapter. Obsidian does not publish a graph-rendering API.
 * Only this module may depend on undocumented renderer properties.
 * Each binding retains/restores its own renderer methods.
 */
'use strict';

function rendererFromLeaf(leaf) {
  const type = leaf?.view?.getViewType?.();
  if (!['graph', 'localgraph'].includes(type)) return null;
  const view = leaf.view;
  const candidates = [view.renderer, view.graph?.renderer, view.graphRenderer,
    view.visualization?.renderer, view.renderer?.renderer];
  for (const r of candidates) {
    if (r && r.containerEl?.nodeType===1 && Array.isArray(r.links) &&
        r.nodeLookup && typeof r.nodeLookup === 'object' &&
        typeof r.scale === 'number' && typeof r.panX === 'number' &&
        typeof r.panY === 'number' && typeof r.onNodeClick === 'function' &&
        typeof r.changed === 'function') return r;
  }
  return null;
}

class NativeGraphAdapter {
  constructor(renderer) {
    this.renderer = renderer;
    this.originalClick = renderer.onNodeClick;
    this.originalGetHighlight = renderer.getHighlightNode;
    this.installed = false;
    this.patchedClick = null;this.patchedGetHighlight = null;
  }
  mount(onNodeClicked, currentLock) {
    if (this.installed) return;
    const r = this.renderer;
    const original = this.originalClick;
    this.patchedClick = function(event, id, type) {
      if (onNodeClicked(event, id, type)) return;
      return original.call(r, event, id, type);
    };
    r.onNodeClick = this.patchedClick;
    const getOld = this.originalGetHighlight;
    this.patchedGetHighlight = function() {
      const node = currentLock();
      if (node) return node;
      return typeof getOld === 'function' ? getOld.call(r) : (r.highlightNode || null);
    };
    r.getHighlightNode = this.patchedGetHighlight;
    this.installed = true;
  }
  unmount() {
    if (!this.installed) return;
    const r = this.renderer;
    if (r.onNodeClick === this.patchedClick) r.onNodeClick = this.originalClick;
    if (r.getHighlightNode === this.patchedGetHighlight) {
      if (this.originalGetHighlight === undefined) delete r.getHighlightNode;
      else r.getHighlightNode = this.originalGetHighlight;
    }
    this.installed = false;
    this.repaint();
  }
  getNativeHoveredNode() { return this.renderer.highlightNode || null; }
  getNode(id) { return this.renderer.nodeLookup?.[id] || null; }
  getLinks() { return this.renderer.links || []; }
  getContainer() { return this.renderer.containerEl; }
  repaint() { try { this.renderer.changed(); } catch (_) {} }
  screenPosition(node) {
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return null;
    const r = this.renderer;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    return { x: (node.x * r.scale + r.panX) / dpr,
      y: (node.y * r.scale + r.panY) / dpr };
  }
  getNodeRadius(node) {
    const r = this.renderer;
    return Math.max(5, Math.min(30,
      (Math.sqrt(Math.max(1, node?.weight || 1)) * Math.max(1, r.nodeScale || 1)
        * Math.max(0.1, r.scale)) / Math.max(1, window.devicePixelRatio || 1)));
  }
  isNearNode(x, y, radiusExtra = 9) {
    for (const node of Object.values(this.renderer.nodeLookup || {})) {
      const p = this.screenPosition(node);
      if (!p) continue;
      if (Math.hypot(p.x-x, p.y-y) <= this.getNodeRadius(node)+radiusExtra) return true;
    }
    return false;
  }
}


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
    this.isInPopup=false;this.pointerInGraph=false;
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
    this.adapter.mount((event,id,type)=>this.onNodeClick(event,id,type),()=>this.lockedPath?this.adapter.getNode(this.lockedPath):null);
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
    this.isInPopup=false;
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
      else if(this.editing||this.isInPopup)wanted=this.focusPath;
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


/* EvidenceWeave v0.3 — unobtrusive enhancements to the NATIVE Graph View.
 * No ItemView, no graph drawing, no R2/Cloud/MCP, no automatic Vault mutation.
 */
'use strict';
const {Plugin,PluginSettingTab,Setting,Notice,MarkdownRenderer,Component,parseYaml}=require('obsidian');
const NODE_KINDS=new Set(['paper','concept','method','dataset','question','center']);
const DEFAULT_SETTINGS=Object.freeze({
  projectFolder:'INSES',overviewPath:'INSES/M00-关系总览.md',
  pdfWidth:330,pdfHeight:450,labelMaxChars:56,
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
    new Setting(containerEl).setName('PDF 浮窗宽度').addSlider(sl=>sl.setLimits(245,520,5)
      .setValue(this.plugin.settings.pdfWidth).setDynamicTooltip().onChange(async v=>{
        this.plugin.settings.pdfWidth=v;await this.plugin.saveData(this.plugin.settings);}));
  }
}

class EvidenceWeavePlugin extends Plugin{
  async onload(){
    const data=await this.loadData()||{};
    this.settings={...DEFAULT_SETTINGS,...data};
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
  parseOverviewRelationships,buildNodeIndex,discoverPdfUrl,rendererFromLeaf,NativeGraphAdapter};
