// EvidenceWeave 0.5.0 - native Graph View enhancement, generated from src/.
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
function validateShortLabel(value) {
  const label = str(value);
  if (!label || label.length > 70 || /[\r\n\u0000-\u001f\u007f]/u.test(label)) {
    throw new Error('图谱短句必须是 1–70 字的单行文字，建议控制在 8–20 字。');
  }
  return label;
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

const OVERVIEW_LABEL_PREFIX={source:'  - **图谱正向短句**：',target:'  - **图谱反向短句**：'};
function overviewLabel(line,direction){
  const prefix=direction==='source'?'图谱正向短句':'图谱反向短句';
  const escaped=prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return textWithoutEol(line).match(new RegExp('^\\s{2,}-\\s*\\*\\*'+escaped+'\\*\\*\\s*[：:]\\s*(.+)$','u'))?.[1]?.trim() || '';
}
function shortLabelFor(relation,viewpoint){
  return viewpoint===relation.source?str(relation.labelFromSource):
    viewpoint===relation.target?str(relation.labelFromTarget):'';
}
function patchOverviewLabel(content,relation,viewpoint,newText){
  const label=validateShortLabel(newText);
  if(relation?.kind!=='overview'||!relation.storage?.sourceLine)throw new Error('需要明确的 M00 关系来源');
  const direction=viewpoint===relation.source?'source':viewpoint===relation.target?'target':null;
  if(!direction)throw new Error('关系视角无效');
  const rows=splitLinesPreservingNewlines(content);
  const indices=rows.map((row,i)=>isOverviewLine(row,relation.id)?i:-1).filter(i=>i>=0);
  if(indices.length!==1)throw new Error('关系编号不存在或重复，不能覆盖');
  const i=indices[0];
  if(textWithoutEol(rows[i])!==relation.storage.sourceLine)throw new Error('原始证据行已变化，请刷新后重试');
  // Only the indented metadata below this exact citation line may be changed;
  // the long reviewed source text and its review status remain untouched.
  let end=i+1;
  while(end<rows.length && /^\s{2,}-\s*/u.test(rows[end])) end++;
  const matches=[];
  for(let j=i+1;j<end;j++)if(overviewLabel(rows[j],direction))matches.push(j);
  if(matches.length>1)throw new Error('此关系存在重复短句字段');
  const previously=shortLabelFor(relation,viewpoint);
  const current=matches.length?overviewLabel(rows[matches[0]],direction):'';
  if(current!==previously)throw new Error('短句已被其他人或同步进程修改，请刷新后重试');
  const eol=content.includes('\r\n')?'\r\n':'\n';
  const newRow=OVERVIEW_LABEL_PREFIX[direction]+label;
  if(matches.length){const old=rows[matches[0]];rows[matches[0]]=newRow+endOfLine(old);}
  else {if(!endOfLine(rows[i]))rows[i]+=eol;rows.splice(end,0,newRow+eol);end++;}
  const statusPrefix='  - **图谱短句审核**：';
  const statusIndices=[];
  for(let j=i+1;j<end;j++)if(textWithoutEol(rows[j]).startsWith(statusPrefix))statusIndices.push(j);
  if(statusIndices.length>1)throw new Error('重复的短句审核字段');
  if(statusIndices.length)rows[statusIndices[0]]=statusPrefix+'用户修改待复核'+endOfLine(rows[statusIndices[0]]);
  else rows.splice(end,0,statusPrefix+'用户修改待复核'+eol);
  return rows.join('');
}
function patchTypedLabel(content,relation,viewpoint,newText,parseYamlFn){
  const label=validateShortLabel(newText);
  if(relation?.kind!=='typed'||!relation.storage?.note||typeof parseYamlFn!=='function')throw new Error('关系来源不可编辑');
  const match=content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/u);
  if(!match)throw new Error('关系笔记没有合法 YAML');
  const fm=parseYamlFn(match[2]);
  if(!fm||str(fm.relation_id)!==relation.id || str(fm.source||fm.source_id)!==relation.storage.sourceKey ||
    str(fm.target||fm.target_id)!==relation.storage.targetKey)throw new Error('关系标识发生变化');
  const key=viewpoint===relation.source?'label_from_source':viewpoint===relation.target?'label_from_target':null;
  if(!key)throw new Error('编辑视角不匹配');
  if(str(fm[key])!==shortLabelFor(relation,viewpoint))throw new Error('短句被同步更改，请刷新后再试');
  const lines=match[2].split(/\r?\n/);
  const keys=lines.map((line,i)=>new RegExp('^'+key+'\\s*:','u').test(line)?i:-1).filter(i=>i>=0);
  if(keys.length>1)throw new Error('发现重复 YAML 短句字段');
  if(keys.length && /:\s*[>|]/u.test(lines[keys[0]]))throw new Error('多行 YAML 请在笔记内修改');
  if(keys.length)lines[keys[0]]=key+': '+JSON.stringify(label);
  else lines.push(key+': '+JSON.stringify(label));
  const statuses=lines.map((line,i)=>/^label_review_status\s*:/u.test(line)?i:-1).filter(i=>i>=0);
  if(statuses.length>1)throw new Error('重复的审核状态');
  if(statuses.length)lines[statuses[0]]='label_review_status: unverified';
  else lines.push('label_review_status: unverified');
  const eol=match[2].includes('\r\n')?'\r\n':'\n';
  return match[1]+lines.join(eol)+match[3]+content.slice(match[0].length);
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
    const extras=[];
    for(let j=i+1;j<lines.length && /^\s{2,}-\s*/u.test(lines[j]);j++)extras.push(lines[j]);
    const labelSource=extras.map(v=>overviewLabel(v,'source')).find(Boolean)||'';
    const labelTarget=extras.map(v=>overviewLabel(v,'target')).find(Boolean)||'';
    const labelStatus=extras.some(v=>/图谱短句审核.*待复核/u.test(v))?'unverified':'reviewed';
    result.push({
      id: anchorMatch[1], source: sourceNode.id, target: dest.id,
      type: 'citation_context', kind: 'overview',
      status: /状态[:：]\s*有限关系已审/u.test(match[2]) ? 'limited_reviewed' : 'unverified',
      summaryFromSource: description,
      labelFromSource:labelSource,labelFromTarget:labelTarget,labelStatus,
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
    labelFromSource: str(frontmatter.label_from_source),
    labelFromTarget: str(frontmatter.label_from_target),
    labelStatus: edgeReviewStatus(frontmatter.label_review_status),
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
    const cache = app.metadataCache.getFileCache(file) || {};
    const fm = cache.frontmatter || {};
    if (str(fm.relation_id) || str(fm.node_type) === 'relation') {
      relationFiles.push({ file, fm }); continue;
    }
    const kind = str(fm.node_type);
    const paperId = str(fm.paper_id);
    const isCenter = kind === 'center' || file.basename === 'C00-INSES';
    // Generic Obsidian Markdown: PDF embeds/links often appear without YAML.
    // Read already-cached metadata; never scan every note body or fetch the PDF.
    const pdfLink = [...(cache.embeds || []), ...(cache.links || [])]
      .map(item => str(item?.link).split('#')[0].split('?')[0])
      .find(link => /\.pdf$/i.test(link)) || '';
    const metadataPdf = str(fm.pdf_path || fm.pdf);
    const hasPdfMetadata=Boolean(str(fm.pdf_url||fm.pdfUrl)||metadataPdf||pdfLink);
    const tags = Array.isArray(fm.tags) ? fm.tags : str(fm.tags).split(/[\s,]+/u);
    const isPaperTag = tags.some(tag => str(tag).replace(/^#/u,'').toLowerCase()==='paper');
    if (!isCenter && !paperId && !NODE_KINDS.has(kind) && !hasPdfMetadata && !isPaperTag) continue;
    const id = paperId || (isCenter ? 'C00' : file.path);
    nodes.push({ id, path: file.path, basename: file.basename,
      title: str(fm.title) || file.basename,
      kind: isCenter ? 'center' : (kind && NODE_KINDS.has(kind) ? kind : 'paper'),
      zoteroKey: str(fm.zotero_key), pdfPath: metadataPdf || pdfLink,
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



/* Pure presentation geometry; renderer physics remain entirely native. */
'use strict';
function safePositive(v, fallback) { return Number.isFinite(v) && v > 0 ? v : fallback; }
function graphScaleFactor(renderer, baseScale) {
  return safePositive(renderer?.scale, 1) / safePositive(baseScale, 1);
}
function worldToScreen(point, camera) {
  if (!point || !camera) return null;
  const dpr = safePositive(camera.dpr, 1);
  const scale = safePositive(camera.scale, 1);
  return { x:(point.x * scale + camera.panX)/dpr, y:(point.y * scale + camera.panY)/dpr };
}
function screenToWorld(point, camera) {
  if (!point || !camera) return null;
  const dpr = safePositive(camera.dpr, 1);
  const scale = safePositive(camera.scale, 1);
  return { x:(point.x * dpr - camera.panX)/scale, y:(point.y * dpr - camera.panY)/scale };
}
function pdfOriginForNode(point, viewport, desiredWidth=495, desiredHeight=810, padding=12) {
  if (!point || !viewport || viewport.width<220 || viewport.height<180) return null;
  const width = Math.max(300, desiredWidth), height = Math.max(320, desiredHeight), gap=28;
  const roomRight = viewport.width-point.x-gap-padding;
  const roomLeft = point.x-gap-padding;
  const side = roomRight >= width || roomRight >= roomLeft ? 'right' : 'left';
  // Only INITIAL placement is kept on screen when possible. The PDF remains a
  // world-space object thereafter: we never shrink or re-side-switch it on zoom.
  const idealX = side==='right' ? point.x+gap : point.x-gap-width;
  const x = Math.max(padding,Math.min(Math.max(padding,viewport.width-width-padding),idealX));
  const idealY = point.y-50;
  const y = Math.max(padding,Math.min(Math.max(padding,viewport.height-height-padding),idealY));
  return {x,y,width,height,side};
}
// Backwards-compatible alias for geometric contract tests, not used to keep
// resizing the panel after its initial placement.
const placePdfByNode=pdfOriginForNode;
function readableEdgeAngle(dx,dy) {
  let a=Math.atan2(dy,dx);
  if(a>Math.PI/2)a-=Math.PI;
  if(a< -Math.PI/2)a+=Math.PI;
  return a;
}
function labelPosition(a,b,ratio=.52) {
  if(!a||!b)return null;
  return {x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio,
    angle:readableEdgeAngle(b.x-a.x,b.y-a.y),length:Math.hypot(b.x-a.x,b.y-a.y)};
}
function rotatedRect(point,width,height,angle) {
  const c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
  const halfW=(width*c+height*s)/2,halfH=(width*s+height*c)/2;
  return {left:point.x-halfW,right:point.x+halfW,top:point.y-halfH,bottom:point.y+halfH};
}
function rectsIntersect(a,b,padding=6) {
  return a.left<b.right+padding && a.right>b.left-padding && a.top<b.bottom+padding && a.bottom>b.top-padding;
}
function avoidLabelCollisions(items,popupRect=null){
  // Items are in priority order (e.g. strongest reviewed relation first).
  // Moving labels ALONG real graph edges is less disruptive than a separate UI.
  const placed=[];
  for(const item of items){
    const {a,b,width,height,zoom=1}=item;
    if(!a||!b||!Number.isFinite(a.x)||!Number.isFinite(b.x))continue;
    const len=Math.hypot(b.x-a.x,b.y-a.y);
    const span=Math.max(0,len-2*17);
    const scaledWidth=width*zoom,scaledHeight=height*zoom;
    if(span<Math.min(scaledWidth+8,24))continue;
    for(const t of [.52,.38,.65,.28,.75]){
      const p=labelPosition(a,b,t);
      if(Math.min(t,1-t)*len<Math.min(scaledWidth*.46+12,span*.5+1))continue;
      const rect=rotatedRect(p,scaledWidth,scaledHeight,p.angle);
      if(popupRect&&rectsIntersect(rect,popupRect,4))continue;
      if(placed.some(q=>rectsIntersect(q.rect,rect,7)))continue;
      placed.push({id:item.id, ...p,rect});
      break;
    }
  }
  return placed;
}
function resizedWorldPanel(original,drag,camera,zoom){
  const factor=safePositive(zoom,1);
  const dx=(drag.x||0)/factor,dy=(drag.y||0)/factor;
  const sx=drag.corner.includes('w')?-1:1,sy=drag.corner.includes('n')?-1:1;
  const newWidth=Math.max(320,Math.min(1800,original.width+sx*dx));
  const newHeight=Math.max(360,Math.min(2200,original.height+sy*dy));
  // Changes to the LEFT/TOP corner move the world-space origin; right/bottom
  // corner changes leave it anchored. Clamp correctly even beyond min/max.
  const xShift=drag.corner.includes('w')? original.width-newWidth:0;
  const yShift=drag.corner.includes('n')? original.height-newHeight:0;
  const worldScale=safePositive(camera?.dpr,1)/safePositive(camera?.scale,1);
  return {width:newWidth,height:newHeight,
    x:original.x + xShift*factor*worldScale,
    y:original.y + yShift*factor*worldScale};
}
/** Translate the PDF in the native graph's WORLD coordinates. Pointer deltas
 * are CSS pixels, so use the inverse native camera transform, not CSS `left`.
 * Width and height remain unchanged and zoom/pan still affect the whole PDF. */
function movedWorldPanel(original, drag, camera) {
  const ratio=safePositive(camera?.dpr,1)/safePositive(camera?.scale,1);
  return {x:original.x+(drag.x||0)*ratio,
    y:original.y+(drag.y||0)*ratio,
    width:original.width,height:original.height};
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


/* EvidenceWeave v0.5 — unobtrusive enhancements to the NATIVE Graph View.
 * No ItemView, no graph drawing, no R2/Cloud/MCP, no automatic Vault mutation.
 */
'use strict';
const {Plugin,PluginSettingTab,Setting,Notice,MarkdownRenderer,Component,parseYaml,requestUrl}=require('obsidian');
const NODE_KINDS=new Set(['paper','concept','method','dataset','question','center']);
const DEFAULT_SETTINGS=Object.freeze({
  projectFolder:'',overviewPath:'',
  pdfWidth:495,pdfHeight:810,rememberPdfSize:true,labelMaxChars:32,
});

class EvidenceWeaveSettings extends PluginSettingTab{
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    const {containerEl}=this;containerEl.empty();
    containerEl.createEl('h2',{text:'EvidenceWeave · 原生图谱增强'});
    containerEl.createEl('p',{text:'只增强原生关系图谱；没有独立图谱页面。节点点击锁定，点击空白取消。Command/Ctrl 点击沿用原生打开笔记。'});
    new Setting(containerEl).setName('Research folder / 研究文件夹').setDesc('只展示此目录中经过记录的论文关系；空值表示整个 Vault。')
      .addText(t=>t.setValue(this.plugin.settings.projectFolder).onChange(async v=>{
        this.plugin.settings.projectFolder=cleanFolder(v);await this.plugin.saveData(this.plugin.settings);await this.plugin.refreshModel();}));
    new Setting(containerEl).setName('Relationship overview note / 关系总览笔记').setDesc('读取 M00 中带 R-Pxx 证据锚点的关系说明。')
      .addText(t=>t.setValue(this.plugin.settings.overviewPath).onChange(async v=>{
        this.plugin.settings.overviewPath=str(v);await this.plugin.saveData(this.plugin.settings);await this.plugin.refreshModel();}));
    new Setting(containerEl).setName('Default PDF width / PDF 默认宽度').setDesc('PDF 会随原生图谱一起缩放，也支持拖动四角改变宽高。').addSlider(sl=>sl.setLimits(320,900,5)
      .setValue(this.plugin.settings.pdfWidth).setDynamicTooltip().onChange(async v=>{
        this.plugin.settings.pdfWidth=v;await this.plugin.saveData(this.plugin.settings);}));
    new Setting(containerEl).setName('Default PDF height / PDF 默认高度').addSlider(sl=>sl.setLimits(360,1300,10)
      .setValue(this.plugin.settings.pdfHeight).setDynamicTooltip().onChange(async v=>{
        this.plugin.settings.pdfHeight=v;await this.plugin.saveData(this.plugin.settings);}));
    new Setting(containerEl).setName('Remember manually resized PDF windows / 记住 PDF 尺寸')
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
  screenToWorld,worldToScreen,graphScaleFactor,pdfOriginForNode,resizedWorldPanel,movedWorldPanel,
  avoidLabelCollisions,NativeGraphBinding,eventMayCommit,buildGraphModel};
