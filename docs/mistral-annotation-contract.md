# Mistral Annotation Contract

Status: active document annotation contract.

## Active Contract

- Broad document contract: `deskreview_document_annotation_v15`.
- Field-specific extraction requirements are carried by JSON Schema descriptions; the annotation prompt retains document-wide scope, grounding, and exclusion rules.
- Reference inventory contract: `deskreview_reference_annotation_v1`.
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
- complete visible body-text citation groups;
- body mentions of tables and figures;
- table and figure display candidates.

The separate reference inventory request is restricted to the original PDF
pages containing raw OCR `references` blocks. Its schema contains only one
`references` array. Its prompt includes every selected block's complete
verbatim text. It must not contain body reference mentions, citation groups,
reference relationships, occurrence counts, or metadata checks.

The broad annotation request receives the complete immutable raw OCR text for
narrative blocks in its existing eight-page range. This is source-location
context, not a second manuscript representation. It lets Mistral copy exact
citation groups and choose the raw block IDs that the reader already uses.
Reference blocks and table HTML remain excluded from that packet.

After all annotation ranges and the bibliography inventory are accepted, the
bounded reference-relation stage receives only validated bibliography handles,
bibliography text, citation-occurrence handles, and exact citation context. It
returns handle-to-handle mappings only. It cannot change counts or source
anchors.

## Source Grounding

Every returned item must include:

- `ocr_page_id`
- `ocr_block_id`
- `exact_quote`

The app may validate that those returned anchors bind to raw OCR. It must not
repair, infer, split, merge, deduplicate, or otherwise change the model-authored
semantic result. Structurally valid annotation chunks are retained unchanged.
An individual citation occurrence is promoted to the relation packet only when
its label equals its item quote and that exact item quote occurs inside its
declared source quote; a non-verbatim item fails closed without invalidating
unrelated items in the same range.

## Regression Gate

`tests/mistral-annotation-contract.test.mjs` and
`tests/reference-annotation.test.mjs` enforce the eight-page range limit,
source identifiers, exact citation text, separated contract scopes, and absence
of citation mapping from the inventory request.
