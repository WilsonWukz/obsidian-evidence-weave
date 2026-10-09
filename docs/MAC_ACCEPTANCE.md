# EvidenceWeave v0.4.1 · Mac Obsidian 1.14.4 acceptance checklist

Use only **Research-MCP-Test**. Back up `.obsidian/plugins/evidence-weave` and `INSES/M00-关系总览.md` first. The plugin does not modify Cloud/MCP.

- [ ] With plugin disabled, measure baseline graph physics and node drag/rebound after enabling Forces.
- [ ] Enable plugin: same physics, native drag and pan; native graph can still be moved while a PDF is locked.
- [ ] Hover paper: native color/fade still works; no UI if paper has no valid PDF.
- [ ] Click paper: lock; move over other papers without focus changing; click empty graph to unlock.
- [ ] Zoom native graph by mouse wheel outside PDF: paper node, relation label and **whole PDF window** scale and pan together, without automatic side switch.
- [ ] PDF initially 495×810 if using old v0.3 defaults; drag each of four corners; zoom out to access corners if offscreen. Size remembered if enabled.
- [ ] Hold PDF **title bar** and drag horizontally/vertically. The window moves, but its width/height, PDF scroll position, locked paper, node positions and native pan/drag are unchanged. Toolbar buttons still work.
- [ ] After moving the PDF, zoom/pan the native graph and verify the PDF follows the graph camera. Drag a resize corner afterward to verify resize still works.
- [ ] Hover C00→P01 actual link: use dedicated short labels, no long summary; M00→P01 navigation does not falsely present the C00 relation.
- [ ] Click the short label; use Chinese IME Enter to choose words; final Enter saves; M00 evidence text unchanged and only new short-label field appears.
- [ ] Edit same source externally before Enter: conflict guard must keep draft; no silent overwrite.
- [ ] Open local PDF; scroll to last page; edit a label and verify scroll position and PDF instance retained.
- [ ] Open remote HNSW and P28 PDFs; scroll to last page; if incomplete click ↻ and retry (30MB cap); otherwise ↗ external open. Screenshot/URL details needed for unreproducible publisher restrictions.
- [ ] Obsidian/Cloud sync: only the intentionally edited Markdown short label is synchronized, no PDF attachment created in Vault or R2.
- [ ] Disable/uninstall plugin: core Graph View works normally and wrapper methods are unpatched.

**Not validated by CI:** actual Obsidian Physics API behavior, Chrome embedded third-party PDF remote pagination across publisher hosts, macOS trackpad mouse-wheel semantics. These require Mac hands-on testing; don't mark them complete based on mocks.
