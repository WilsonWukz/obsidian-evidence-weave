# EvidenceWeave relationship schema

One Markdown note can encode a typed relation via YAML frontmatter; the plugin reads it locally and never edits it.

```yaml
---
node_type: relation
relation_id: R-INSES-P21
source: C00
target: P21
relation_type: background
summary_from_source: "INSES cites Dense X Retrieval as fine-grained retrieval background."
summary_from_target: "Dense X Retrieval is background context for INSES, not a measured baseline."
review_status: limited_reviewed
evidence:
  note: INSES/P21-Dense-X-Retrieval.md
  block: R-P21-01
  section: "§2"
  page: 3
  quote: "A proposition should be minimal"
  pdf_url: https://aclanthology.org/2024.emnlp-main.845.pdf
---
```

Every summary is an authored **claim**, not machine-verified fact. `review_status` does not mean the plugin audited the paper. `limited_reviewed` means only a limited relation was reviewed. Invalid/ambiguous endpoint IDs are skipped. A typed relation with an ID matching an M00 legacy edge overrides the latter. Do not use ordinary `[[wikilinks]]` as proof of scholarly relations.

For current INSES M00 notes, legacy entries containing `[[P21-Dense-X-Retrieval#^R-P21-01|...]]：...` are imported as edges from C00 to P21, linking to the R-P21-01 evidence block.

Use `pdf_path` in paper frontmatter to point at a PDF actually stored inside the local Vault; otherwise `pdf_url` or an explicitly linked remote PDF is used. Publisher policy may block remote iframe embedding.
