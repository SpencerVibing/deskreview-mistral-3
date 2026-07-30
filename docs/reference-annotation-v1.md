# Reference Annotation V1

Status: active bounded reference-inventory stage.

Contract: `deskreview_reference_annotation_v1`.

## Purpose

Use Mistral Document Annotation to inventory a bibliography reliably
when the request is restricted to the original PDF pages that raw OCR already
classified as containing `references` blocks.

## Contract

- Raw OCR remains immutable and is not repeated.
- Raw OCR `references` block types directly select the original PDF pages.
- The selected pages must be one contiguous range of no more than eight pages.
- Exactly one live reference annotation request is permitted.
- It runs after the first broad annotation range and before later broad ranges,
  so it does not compete with another Mistral OCR request.
- The annotation schema contains only one `references` array.
- The prompt includes every selected references block and its complete verbatim
  OCR text.
- Every returned entry contains its original OCR page ID, block ID, and a short
  exact quote wholly contained in that declared starting block.
- Validation is passive. An unknown block, wrong page, or ungrounded quote is
  reported and never repaired.

Validated entries populate the References count and the source-linked
bibliography rendered in the HTML reader. The broad page-range annotation stage
does not extract bibliography entries.
