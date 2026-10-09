# EvidenceWeave

**Add contextual PDF previews and editable relationship labels to Obsidian's native Graph view.**

EvidenceWeave is a lightweight **desktop** plugin. It does **not** replace Obsidian's force-directed graph or create a second graph page.

## Features

- Hover a paper node: see Obsidian's normal highlighted neighbors, short directional labels on documented relationships, and a PDF preview if a source exists.
- Click to lock focus; click empty canvas to unlock. Cmd/Ctrl-click retains native open-note behavior.
- Drag the PDF window by its title bar and resize from any corner. PDF panel and labels move and scale with the graph; wheel scrolling inside a PDF turns pages.
- Click a relation label to edit. Enter saves to the original Markdown note (Esc cancels; Chinese/other IME composition supported). Editing a **short label** never overwrites the original long scholarly evidence and marks that label for review.
- Ordinary note metadata updates do not unnecessarily reload a PDF being read. Where publisher embeds fail, ↗ opens the original file in a browser; ↻ optionally retries a one-time complete in-memory PDF fetch.
- Never creates phantom edges or claims that a wikilink proves a scientific relationship.

## Install and try

Once listed in Obsidian, enable EvidenceWeave from **Community plugins**, then open Obsidian's built-in **Graph view**. For manual installation, copy `main.js`, `manifest.json`, `styles.css` from the matching [GitHub Release](https://github.com/WilsonWukz/obsidian-evidence-weave/releases) into `.obsidian/plugins/evidence-weave/`.

PDF sources: YAML `pdf_path` / `pdf` / `pdf_url`, a local Markdown PDF embed such as `![[paper.pdf]]`, or a direct PDF link in a recognized paper note. If no PDF exists, no popup appears.

The optional **research folder** and **overview note** settings are blank by default (entire Vault; no special overview). Users with existing custom settings keep them when updating. A legacy INSES-overview importer is optional, not required.

## Short relation records

Create a Markdown relation note with YAML:

```yaml
---
node_type: relation
relation_id: R-paper-a-b
source: Papers/Paper A.md
target: Papers/Paper B.md
relation_type: compares
label_from_source: "Compares its retrieval strategy with B"
label_from_target: "Serves as a retrieval comparison for A"
label_review_status: unverified
summary_from_source: "Detailed interpretation with the citation and caveats."
summary_from_target: "Detailed explanation from B's viewpoint."
review_status: unverified
---
```

A real wikilink must connect both paper notes for Obsidian's native Graph view to draw the edge. EvidenceWeave adds labels to those **existing edges only**. Detailed evidence and short labels are separate. See [relationship schema](docs/RELATION_SCHEMA.md).

## Privacy, network use and safety

- **Local-first.** Reads Markdown and metadata from the current Vault. No account, external sync service, MCP endpoint, analytics, telemetry, ads, self-updating code or data uploads to the maintainer.
- **Remote PDF preview connects directly to the host in the note's PDF link** (journal, university, proceedings or preprint server). The server may observe your IP and request headers. If you press ↻, Obsidian's `requestUrl` fetches the complete linked PDF once into memory; **the 30 MB limit is checked after the response arrives** (not a pre-download bandwidth cap), and the temporary in-memory object is released on closing/switching files. Some publishers disable embedded previews.
- **Writing is explicit.** Only pressing Enter after editing a relation label triggers a guarded `vault.process` update inside the current Vault. Any subsequent sync is performed by your existing, separate Obsidian sync setup, not by this plugin.
- Does not access files outside the Vault. External browser opening happens only when you click ↗.

## Compatibility and known limitations

Desktop Obsidian **1.14.4+**. The native Graph renderer uses undocumented internal APIs: future Obsidian versions can break that integration. Unsupported internal structures leave the native view alone. The built-in Chromium PDF renderer and external publishers may prevent later pages loading; click ↗ to read the original. Relation labels do not replace evidence verification.

## Development

Node.js 18+; no runtime npm dependencies. `main.js` is generated from `src/` using `npm run build`; `npm run check` builds and runs tests. Source-build parity and release-asset validation run in CI. The [manual release workflow](.github/workflows/release.yml) creates the exact-version tag and Release assets.

## License and attribution

[MIT](LICENSE). Independent implementation inspired by the public approaches of [Graph Edge Notes](https://github.com/li-zane/obsidian-graph-edge-notes) and [Graph Highlight Lock](https://github.com/ruruoni1/obsidian-graph-highlight-lock). Not affiliated with or endorsed by Obsidian.

---

## 中文简介

EvidenceWeave **只增强 Obsidian 原生关系图谱**，不新建图谱页面。悬停论文节点展示关联关系及 PDF（无 PDF 不显示），点击节点锁定、点击空白处解除。PDF 可以拖动标题栏移动、拖动四角调整大小，并随图谱一起平移和缩放；在 PDF 内滚动可翻页。关系短句点击后可编辑并按 Enter 保存到 Markdown，**不会覆盖详细证据**。

默认扫描整个 Vault；可设置研究文件夹。支持笔记中 `pdf_path`、`pdf_url`、`![[paper.pdf]]` 等 PDF 来源。只有原生双链与明确的关系记录才能产生语义标签，不会凭空猜测学术关系。

**网络和隐私：**在线 PDF 预览会直接连接 PDF 来源网站，网站可能看到访问 IP。↻ 会按需将 PDF 暂存在内存中，不上传插件开发者服务器。只有你修改短句并按 Enter 后才会写入当前 Vault。插件不包含遥测和 Cloud/MCP 同步。
