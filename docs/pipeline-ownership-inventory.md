# Pipeline Ownership Inventory

Status: active ownership inventory after retiring Reference Audit V2.

This inventory records the active manuscript-pipeline owners. Its purpose is to
prevent future drift and duplicate ownership.

## Active Entry Points

- Browser app: `public/app.js`
- Static home and stored-review UI: `public/home.js`, `public/review-store.js`
- Local server: `server/index.js`
- Analysis orchestration: `server/analysis-service.js`
- Netlify OCR function: `netlify/functions/ocr.mjs`

## Production Owners

- Raw OCR request owner: `services/mistral-ocr.js`
- Annotation request owner: `services/mistral-ocr.js`
- Production annotation schema and prompt owner: `core/document-annotation.js`
- Annotation contract limits and compact-schema assertions:
  `core/mistral-annotation-contract.js`
- Annotation response shape validation:
  `core/document-annotation-validation.js`
- Annotation projection and display-link candidate assembly:
  `core/annotation-stages.js`
- Reproducible article and abstract word counts from model-selected OCR blocks:
  `core/article-word-count.js`
- Exact source anchoring:
  `core/source-anchor.js`
- Bibliography inventory schema, prompt, and source contract:
  `core/reference-annotation.js`
- Bibliography provider request:
  `services/mistral-ocr.js`
- Bibliography HTTP orchestration:
  `server/analysis-service.js`
- Document QnA display-link contract:
  `core/display-links-contract.js`
- Document QnA display-link request owner:
  `services/mistral-display-links.js`
- Reference relation contract and passive validation:
  `core/reference-links-contract.js`
- Bounded reference relation request owner:
  `services/mistral-reference-links.js`
- Stored-review persistence:
  `public/review-store.js`

## Retired Benchmark Modules

The earlier V2 benchmark contract, chunk-merge implementation, reference
inventory contract, reference start-chain contract, and reference relation-link
contract were removed because they kept duplicate manuscript-semantic ownership
in the repository. Future prompt/schema benchmarks must be documented as
one-manuscript experiments and must not add an alternate runtime contract beside
the active owners listed above.

## Known Fixture Evidence

Current cached provider payloads live under `data/benchmarks/` and stored-review
payloads under `public/data/stored/`. Tests must treat these files as immutable
input evidence. Test code may read them; it must not regenerate or rewrite them.

The psyArXiv failure that motivated the retired reference experiments was:

- the bibliography was partially projected as 14 structured references while the
  raw OCR/stored HTML showed many more references;
- article-body coverage missed later manuscript text, including the Conclusion.

Bibliography inventory remains deliberately narrow. The broad annotation
contract independently returns exact body citation occurrences; one bounded
relation stage maps only those validated occurrence handles to validated
bibliography handles.

## OCR Scheduling Invariant

Mistral OCR requests for one manuscript must not compete concurrently. The
browser schedules them in this order:

1. Full-document raw OCR.
2. The first broad annotation range, so front-matter counts can appear early.
3. The dedicated bibliography inventory request.
4. The remaining broad annotation ranges.

This ordering is a reliability contract, not a performance preference.
Concurrent bibliography and broad-annotation requests have produced
timing-dependent provider throttling in which either the reference count or a
later article range became unavailable. `tests/reader-shell.test.mjs` asserts
the request order. Do not replace it with `Promise.all` or another concurrent
OCR scheduler without explicit provider-limit evidence and a regression test.

## First Regression Gate

`tests/pipeline-ownership.test.mjs` enforces this inventory at source level. It
does not prove semantic correctness; it prevents accidental architecture drift
while the pipeline is rebuilt step by step.
