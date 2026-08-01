# Reference Inventory V2 Architecture Decision

Status: superseded by `deskreview_reference_annotation_v6`; retained as historical architecture evidence.

## Scope

Raw OCR selects every block already typed `references`. When those blocks occupy
one contiguous range of no more than eight original PDF pages, one bounded
reference-only Document Annotation request receives:

- those original PDF pages;
- the complete verbatim OCR text of every selected references block;
- the block's original OCR page and block identifiers;
- a compact block-keyed schema containing exactly one result for every supplied
  OCR references block.

Mistral returns, for every block in supplied order, the complete individual
bibliography entries that begin in that block. Continuation-only blocks remain
explicit with an empty `references` array.
The broad page-range annotation contract does not extract references.

The reference count is published only when the complete returned bibliography
inventory passes passive source validation.

## Explicitly Out Of Scope

The following are out of scope for the bibliography-inventory request itself.
Broad page-range annotation selects article prose blocks. Body citation
occurrences are owned by the separate block-keyed body-citation contract, and
bibliography-to-citation relationships are owned by the bounded
reference-relation stage:

- body citation extraction;
- citation occurrence counts;
- bibliography-to-body mapping;
- unmatched-citation warnings;
- reference metadata or quality checks;
- local splitting, merging, deduplication, or semantic repair.

## Call Budget

Bibliography inventory is one explicit background request to
`/api/ocr/references`. It runs independently of the broad page-range annotation
stage and has a hard maximum of one provider request and eight original PDF
pages. There is no retry, fallback, overlap, local splitting, or repair.

## Failure Behavior

The complete reference result is accepted only when every supplied block has
exactly one result in supplied order and every returned entry has a
`reference_list_anchor_text` value contained in its parent block. Otherwise the stage fails closed and preserves
the raw OCR reader. The rejected block-keyed response and its issues remain
visible only in Developer diagnostics.
