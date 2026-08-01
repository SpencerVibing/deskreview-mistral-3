# Mistral Annotation Contract

Status: active document annotation contract.

## Active Contract

- Broad document contract: `deskreview_document_annotation_v16`.
- Field-specific extraction requirements are carried by JSON Schema descriptions; the annotation prompt retains document-wide scope, grounding, and exclusion rules.
- Reference inventory contract: `deskreview_reference_annotation_v7`.
- Body-citation inventory contract: `deskreview_body_citations_v10`.
- Request owner: `services/mistral-ocr.js`.
- Schema and prompt owner: `core/document-annotation.js`.
- Validation owner: `core/document-annotation-validation.js`.

Each annotation request sends one explicit sequential page range of at most
eight zero-based OCR page indexes to `mistral-ocr-latest` with both:

- `document_annotation_format`
- `document_annotation_prompt`

The broad page-range annotation schema owns only:

- front matter: title, authors, affiliations, author-affiliation links,
  keywords, and abstract anchor;
- body sections and prose-block classifications for exact abstract/article word
  counts from raw OCR blocks;
- body mentions of tables and figures;
- table and figure display candidates.

The separate reference inventory request is restricted to the original PDF
pages containing raw OCR `references` blocks. Its schema contains only one flat
`references` array in printed order. Its prompt includes every selected block's
complete verbatim text. It
must not contain body reference mentions, citation groups, reference
relationships, occurrence counts, or metadata checks.

Each returned bibliography entry contains only a unique ID and its complete
verbatim reference text. DeskReview renders those entries as independent HTML
targets. Reference counting and HTML navigation do not require a copied source
anchor or a model-authored OCR block association.

After broad annotation has selected the article prose blocks, the explicit,
user-visible body-citation stage sends each bounded block packet to
`mistral-ocr-latest` with the v10 block-keyed schema and prompt. The request
contains the original PDF pages plus the complete immutable raw OCR text of
only those selected article blocks. The schema requires exactly one result per
supplied block, in the same order, and every visible citation occurrence in
each block. Repeated labels remain separate occurrences.

Each returned citation contains only `citation_text`, copied exactly from its
identified raw OCR block. That exact marker drives relation mapping and
navigation; the immutable OCR block supplies the complete displayed context.
The app checks block cardinality/order, exact source existence, and whether the
response overstates the number of identical source occurrences. It does not
repair, relocate, normalize, or deduplicate a model response.

Body-citation packets never overlap. They are split at original page boundaries
when adding another page would exceed eight pages or eight selected OCR article
blocks. A hard budget of 12 body-citation requests applies per manuscript; the
stage does not retry with changed prompts, pages, or semantic scope.

After all annotation ranges and the bibliography inventory are accepted, the
bounded reference-relation stage receives only validated bibliography handles,
bibliography text, citation-occurrence handles, and exact citation context. It
uses `deskreview_reference_relation_decisions_v4` to classify every candidate
as `bibliographic_citation` or `not_bibliographic`. Genuine citations carry
only bibliography handles; non-citations carry none. The stage cannot change
counts, manuscript text, or source anchors.

## Source Grounding

Broad document and body-citation items must include:

- `ocr_page_id`
- `ocr_block_id`
- `exact_quote`

The app may validate that those returned anchors bind to raw OCR. It must not
repair, infer, split, merge, deduplicate, or otherwise change the model-authored
semantic result. Structurally valid annotation chunks are retained unchanged.
A citation range is promoted to the relation packet only when every supplied
OCR article block is represented exactly once, every citation marker exists in
its identified block, and no exact marker is returned more often than it occurs
there. An invalid range
fails closed and its raw response remains available in Developer diagnostics.
Bibliography entries are the deliberate exception: v6 validates the flat
reference list, unique IDs, non-empty complete text, and coarse aggregate text
coverage. It does not request copied per-reference anchors or model-authored
OCR block associations.

## Regression Gate

`tests/mistral-annotation-contract.test.mjs`,
`tests/reference-annotation.test.mjs`, and
`tests/citation-annotation.test.mjs` enforce the eight-page range limit,
complete block coverage, source identifiers, exact citation text, separated
contract scopes, and absence of citation mapping from the inventory request.
`tests/preprint-reference-freeze.test.mjs` pins the contract digest, all five
stored preprint bibliography counts, and the missing/duplicate/reordered block
failure modes. It also freezes the medRxiv superscript and
page-boundary cases. The rejected v6 source-parts experiment is retained as
immutable evidence and is not part of the active request path.
