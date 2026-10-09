# EvidenceWeave v0.4 relationship schema

Independent `node_type: relation` YAML notes and legacy M00 anchored lines remain supported. Graph labels now have a separate short text field per perspective.

```yaml
---
node_type: relation
relation_id: R-C00-P21
source: C00
target: P21
relation_type: citation_context
label_from_source: "提供细粒度检索背景"   # visible on the C00→P21 actual graph edge
label_from_target: "被 INSES 用于粒度讨论"  # visible when P21 is the focus
label_review_status: unverified
summary_from_source: "INSES §2.2 cites this work in retrieval granularity background, not a measured baseline."
summary_from_target: "This work is cited as research background for INSES, not an experimental result."
review_status: limited_reviewed
evidence:
  note: INSES/P21-Dense-X-Retrieval.md
  block: R-P21-01
  page: 3
---
```

A `.md` link connecting the two nodes must actually exist inside the Vault before the native graph can show the relation edge. No synthetic edges are added. A M00→P21 navigation link **must not** reuse the C00→P21 academic statement. If no `label_from_*` is available, clicking the small `＋短句` label fills it, preserving `summary_from_*` and `review_status`.

The legacy overview equivalent is a source line with `[[...#^R-P21-01|...]]：...` followed immediately by optional indented lines `**图谱正向短句**` and `**图谱反向短句**` and `**图谱短句审核**`. An inline edit only alters these dedicated label lines with conflict checking.
