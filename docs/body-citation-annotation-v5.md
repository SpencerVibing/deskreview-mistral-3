# Body Citation Annotation V5

Status: historical contract (`deskreview_body_citations_v5`). The active contract is documented in `body-citation-annotation-v6.md`.

## Purpose

Extract every visible bibliography-citation occurrence from the OCR article
blocks selected by broad document annotation. This stage does not identify the
bibliography and does not map citations to references.

## Request

- Provider model: `mistral-ocr-latest`.
- Source: original PDF pages plus complete raw OCR text for the selected article
  blocks on those pages.
- Range: one non-overlapping, page-bounded packet of at most eight PDF pages
  and normally at most 20 selected OCR article blocks.
- Format: `deskreview_body_citations_v5`.
- Budget: one request per user-visible article-block range, with a hard maximum
  of 12 requests per manuscript and no semantic retries.

The schema requires one `citation_blocks` result for every supplied OCR block,
in packet order. Each block result contains zero or more exact citation
occurrences. Repeated labels remain separate occurrences. The exact citation
anchor belongs wholly to the block containing the printed citation marker.

## Passive Checks

The app reports and fails closed on missing, duplicated, reordered, unknown, or
wrong-page block results and citation anchors that do not exist exactly in their
identified raw OCR block. It does not relocate, normalize, or repair anchors.

## Regression Evidence

`tests/citation-annotation.test.mjs` covers block order, repeated occurrences,
and exact block grounding. `tests/preprint-reference-freeze.test.mjs` pins the
contract digest and the medRxiv superscript and page-boundary fixtures.

The rejected v6 source-parts experiment is recorded in
`docs/body-citation-source-parts-experiment.md` and its immutable response is in
`data/benchmarks/body-citation-v6-medrxiv-1785531290176.json`.
