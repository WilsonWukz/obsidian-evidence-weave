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

