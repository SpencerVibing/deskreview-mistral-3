# Body Citation Annotation v7

Status: historical contract (`deskreview_body_citations_v7`). The active contract is documented in `body-citation-annotation-v8.md`.

Each provider-authored occurrence has two explicit fields:

- `citation_text` preserves the visible bibliographic citation marker or group
  for relation mapping.
- `citation_anchor_text` is a distinct, exact adjacent substring copied from
  the authoritative raw OCR block for passive grounding and HTML navigation.

This separation prevents visually equivalent PDF and OCR encodings, such as
Unicode superscripts and LaTeX markup, from invalidating a real occurrence.
The anchor must remain wholly inside the declared block and is checked without
normalization or relocation. Invalid occurrences are excluded; independently
grounded occurrences remain eligible for the bounded relation stage.
