# Reference Annotation V6

Status: active bounded bibliography-inventory stage.

Status: historical contract (`deskreview_reference_annotation_v6`). The active contract is documented in `reference-annotation-v7.md`.

## Purpose

Turn the bibliography blocks already selected by raw OCR into complete,
individual reference objects. Each object is rendered as its own stable HTML
target. This stage does not inspect article-body citations or parse reference
metadata.

## Contract

- One bounded annotation request covers the contiguous original PDF pages that
  contain raw OCR `references` blocks, up to eight pages.
- The prompt supplies the complete text of every selected bibliography OCR
  block.
- The response contains one flat `references` array in printed order across the
  complete supplied OCR block packet.
- Every bibliography entry is returned once with only a unique `id` and its
  complete verbatim `text`.
- A reference that continues into another OCR block remains one item.
- No secondary reference anchor, excerpt, summary, or metadata parse is
  requested.

## Projection

DeskReview creates one HTML list item per returned reference. The
model-authored reference ID is retained as the stable jump-link handle. Raw OCR
blocks remain request input and diagnostics only; the response does not assign
references back to individual blocks.

## Passive Checks

The app blocks malformed reference arrays, malformed or duplicate reference
IDs, empty complete text, and grossly incomplete aggregate character coverage.
It does not repair, split, merge, deduplicate, or relocate bibliography
entries.

## Call Budget

The bibliography inventory uses one provider request. There is no semantic
retry, fallback, overlap, or repair call.
