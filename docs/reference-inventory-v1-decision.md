# Reference Inventory V1 Architecture Decision

Status: active.

## Scope

Raw OCR selects every block already typed `references`. When those blocks occupy
one contiguous range of no more than eight original PDF pages, one bounded
reference-only Document Annotation request receives:

- those original PDF pages;
- the complete verbatim OCR text of every selected references block;
- the block's original OCR page and block identifiers;
- a compact schema containing only an array of bibliography entries.

Mistral returns the complete individual bibliography entries in printed order.
The broad page-range annotation contract does not extract references.

The reference count is the number of returned bibliography entries. Source
validation affects only whether an entry is clickable; it never removes the
entry from the count.

## Explicitly Out Of Scope

The following are out of scope for the bibliography-inventory request itself.
Body citation occurrences are owned by the broad page-range annotation
contract, and bibliography-to-citation relationships are owned by the bounded
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

The complete reference result is accepted only when every returned entry has a
known starting block and an exact quote contained in that block. Otherwise the
stage fails closed and preserves the raw OCR reader.
