# Display Links Stage

This document describes the bounded table/figure relation stage.

References are not part of this display-link stage. Bibliography inventory,
body-citation extraction, and citation-to-reference relations have separate,
bounded contracts.

The display-link stage maps only already source-validated table and figure
mention handles to already source-validated table and figure display handles.
It returns opaque handles only; it never authors manuscript text, page numbers,
quotes, bibliography entries, citations, or source locations.

Runtime shape:

1. Raw OCR returns the reader source of truth.
2. Page-range annotations return display candidates and body display mentions.
3. `core/annotation-stages.js` preserves those candidates with opaque handles.
4. `services/mistral-display-links.js` sends one bounded handle-only request.
5. `core/display-links-contract.js` passively validates the returned handle
   partitions.

The display-link request is user-visible and optional. A failed or disabled
request leaves direct table and figure anchors available and must not block the
OCR reader, count tiles, or bibliography inventory.

`deskreview_display_relation_mappings_v1` requires every supplied display
mention handle and every supplied display candidate handle to appear in exactly
one valid partition: mapped or unmatched/unmentioned, never both.
