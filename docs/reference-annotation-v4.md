# Reference Annotation V4

Status: superseded by `deskreview_reference_annotation_v6`; retained as historical contract evidence.

Contract: `deskreview_reference_annotation_v4`.

## Purpose

Use Mistral Document Annotation to inventory a bibliography reliably when the
request is restricted to the original PDF pages that raw OCR already classified
as containing `references` blocks.

## Contract

- Raw OCR remains immutable and is not repeated.
- Raw OCR `references` block types directly select the original PDF pages.
- The selected pages must be one contiguous range of no more than eight pages.
- Exactly one live reference annotation request is permitted.
- It runs after the first broad annotation range and before later broad ranges,
  so it does not compete with another Mistral OCR request.
- The annotation schema contains only one top-level `reference_blocks` array.
- The response contains exactly one result for every supplied OCR references
  block, in the same order. A block that only continues an earlier entry returns
  an empty `references` array.
- The prompt includes every selected references block and its complete verbatim
  OCR text.
- Each bibliography entry has `text`, containing the complete verbatim entry,
  and `reference_list_anchor_text`, containing a short exact anchor inside the
  reference-list block where the entry begins. The anchor is not body-text
  citation evidence. It remains within one block when the complete entry spans
  another block or page.
- Validation is passive. Missing, duplicate, reordered, or unknown blocks;
  wrong pages; duplicate reference IDs; and ungrounded reference-list anchors
  are reported and never repaired.
- Failed responses retain their returned entries and per-entry issues for the
  Developer diagnostics bibliography audit. They do not populate the
  user-facing reference count.

Validated entries populate the References count and the source-linked
bibliography rendered in the HTML reader. The broad page-range annotation stage
does not extract bibliography entries.
