# EvidenceWeave · 论文证据关系工作台

**A local-first Obsidian desktop plugin for reading paper-relationship explanations alongside source PDFs, instead of mistaking plain wikilinks for scholarly evidence.**

![Status](https://img.shields.io/badge/version-0.1.0%20MVP-blue) ![No runtime deps](https://img.shields.io/badge/runtime%20dependencies-0-green)

> Independent of `obsidian-knowledge-mcp` and the Cloudflare/Remotely Save deployment. **This plugin reads the local Vault only.** It does not connect to ChatGPT, Zotero Cloud APIs, GitHub, or any MCP server; it does not write or publish research notes.

## What works in v0.1

- Dedicated **EvidenceWeave graph view** in Obsidian, with draggable nodes, pan, zoom, search, and quick-reset.
- Hover a paper node to highlight its immediate neighbors and show **one sentence per connected edge**, from the hovered paper's viewpoint. Complete summaries are also listed in the scrollable right pane; graph labels are shortened where space is limited.
- Click a paper to pin the right-hand **PDF reading pane**. Hover a different paper for a temporary preview. Supports Vault-local PDFs through Obsidian's native Markdown PDF embed and external `.pdf` URLs via iframe (publisher embedding restrictions may apply).
- Click any annotated edge to inspect an **evidence card**: provenance status, statement, source note, citation anchor, original short quote and recorded PDF page (when available). Open the exact note block to verify yourself.
- Read existing `INSES/M00-关系总览.md` entries and `R-Pxx-01` anchors: compatible with the current 30-paper SOP project; **does not fabricate paper-to-paper research relationships**.
- Optional visualization of ordinary `[[wikilinks]]` as dashed, **unverified** links, off by default.
- Read typed relation notes using YAML frontmatter without changing existing note formats. See [`docs/RELATION_SCHEMA.md`](docs/RELATION_SCHEMA.md).
- Scoped to the `INSES` folder by default; configurable for other projects.

## Install on Mac (manual local plugin install)

1. Download the prepared release package `evidence-weave-plugin-v0.1.0.zip` or build this repository.
2. In your **test** Vault, open the hidden `.obsidian/plugins` folder, create `evidence-weave/`.
3. Copy `manifest.json`, `main.js`, and `styles.css` into that folder (**not** the entire source ZIP). The final paths must look like:

   ```text
   Research-MCP-Test/.obsidian/plugins/evidence-weave/manifest.json
   Research-MCP-Test/.obsidian/plugins/evidence-weave/main.js
   Research-MCP-Test/.obsidian/plugins/evidence-weave/styles.css
   ```

4. In Obsidian → Settings → Community plugins, enable community plugins if necessary and enable **EvidenceWeave**. The ribbon's network icon opens the graph. You can also run **Open EvidenceWeave paper understanding graph** from the command palette.
5. In plugin settings confirm Project Folder `INSES`, Overview Path `INSES/M00-关系总览.md`.
6. Hover `P21-Dense-X-Retrieval` to read its relationship with INSES. Click the relationship, then **跳到证据笔记**. If a PDF URL exists inside the note, the right pane displays it (or provides a browser fallback).

### Important PDF limitation

`pdf_path` is optional and must point to an actual PDF file **inside this Vault**, e.g. `Attachments/paper.pdf`. Existing Zotero attachments stored only in Zotero are not magically imported. For a source PDF URL embedded in Markdown, the plugin attempts an inline preview; cross-origin restrictions or publishers' `X-Frame-Options`/CSP can block it, so the **Open PDF in browser** link is always provided. Inline preview contacts the publisher; disable online PDF previews in settings for privacy or when offline.

## Data contract

For existing INSES notes, `paper_id: P21` identifies the graph node and `M00` contains a row like:

```md
- [[P21-Dense-X-Retrieval#^R-P21-01|P21 · Dense X Retrieval]]：INSES 引用这项工作作为检索粒度背景。 状态：有限关系已审。
```

The plugin reads the row and existing evidence anchor; it does **not** claim that `P21` experimentally outperformed `P18` or any other paper. New typed relationships can be authored under `INSES/Relations/` (or another Markdown path) using the separate schema. Missing/ambiguous endpoints are skipped, never guessed.

Review statuses reflect what's written in the source note, not what the plugin has independently audited. `limited_reviewed` means a limited citation relation was checked, not a full-paper or replication audit. The original English quote is merely displayed for the reader to verify.

## Development

No runtime dependencies, external build service or network access are required. Node.js 18+:

```bash
npm test
npm run build
```

`src/main.js` is the source. `npm run build` copies it to the standalone Obsidian-compatible CommonJS `main.js`. `styles.css` and `manifest.json` are loaded by Obsidian. Tests exercise extraction, directional statements, fallback behavior and the data model with synthetic notes.

For official release packaging, upload `main.js`, `manifest.json`, `styles.css` to a GitHub release with tag `0.1.0`, as recommended by the [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin). **v0.1 is a test release, not yet accepted against a running Mac Obsidian instance.** Live UI/PDF embedding must be confirmed in `Research-MCP-Test` before production use.

## Roadmap

- v0.1 local MVP: native evidence graph + PDF reader + edge explanations and anchors.
- v0.2: reliable PDF page highlighting, structured relation editor (manual approval), stronger layout/collision handling, optional understanding checkpoints.
- v0.3: optional Zotero attachment resolution / citation metadata validation, strictly separate from the existing MCP.

## Security and provenance

- Read-only. No file edits, Cloudflare, OAuth tokens, or MCP calls.
- A remote PDF link from a note is an outbound network request. Disable remote preview if undesired.
- Private research notes and copyrighted PDFs are **not** included in this repository. Examples and tests contain only fabricated data.
- Markdown and relation labels are rendered via text nodes; no raw HTML injection or execution of note content.

MIT © 2026 Kezhao Wu.