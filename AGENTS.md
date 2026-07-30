# DeskReview Mistral 3 Agent Rules

## Product Boundary

- This is a clean rebuild. Do not copy runtime code from `deskreview-mistral-2` or other DeskReview projects.
- Treat `deskreview-mistral-2` as a visual and behavioral reference only when the user explicitly asks for a feature to be ported.
- Build the reader UI before optional review features.
- Do not execute, import, invoke, depend on, copy fixtures from, or use test tooling from another DeskReview project. Mistral-3 must own its runtime, fixtures, scripts, dependencies, and verification commands.

## Architecture

- `public/` contains markup, Bootstrap styling, and static assets only.
- `app/` contains browser state and DOM interaction only.
- `core/` contains pure, tested transforms with no browser, network, or provider imports.
- `services/` contains API and storage adapters only.
- `server/` contains HTTP, validation, and provider orchestration only.
- Dependencies flow only from `app` to `core/services`, and from `server` to `core/services`.

## OCR Contract

- One `mistral-ocr-latest` request is the primary manuscript source of truth.
- A fast raw OCR request may be used as the immediate reader stage to render only OCR-returned pages, blocks, headings, tables, figures, images, headers, footers, and coordinates. It must never produce semantic counts or inferred structure.
- The immediate ToC may project OCR-returned heading/title blocks or explicit Markdown heading tokens to existing page anchors. It must never infer headings from visual styling or call another model.
- Structured manuscript data is a separate annotation stage. Follow [docs/mistral-annotation-contract.md](docs/mistral-annotation-contract.md) before changing its schema, prompt, or service code. The raw and annotation stages must remain visibly distinct in the UI.
- Mistral document annotations are limited to eight pages. Every annotation request must send both `document_annotation_format` and `document_annotation_prompt`, with one explicit sequential range of at most eight zero-based page indexes. No request may omit its page range.
- Annotation schemas must contain compact source-grounded structure. Full verbatim bibliography entries are allowed only in the single production `bibliography.entries` inventory because the UI must preserve individual references without local splitting. Do not duplicate OCR markdown, HTML tables, or full document text.
- The app may join only exactly equal model-authored IDs across accepted chunks and bind an exact returned quote to raw OCR. It must not infer, repair, reconcile, synthesize, split, merge, rank, or guess a manuscript-semantic relationship.
- Require a source for every schema item: zero-based OCR page index, exact verbatim quote, and an OCR block/coordinate reference when Mistral returns one.
- Put all handling of messy formatting in the annotation prompt: line numbering, repeated headers/footers, cover sheets, tables, figures, front matter, bibliography continuations, and source locations. Improve the schema/prompt when quality fails.
- Never infer, repair, reconcile, synthesize, split, merge, rank, or guess manuscript structure locally. Do not use chat/completion calls to recreate structure requested through document annotation.
- Deterministic code may validate the schema, render model-returned values, and bind an exact returned source reference to returned OCR content. It must never change a model-authored answer or fabricate a fallback.
- An incomplete, slow, invalid, or unlinked annotation is an annotation-contract failure. Cache the failing response, improve the JSON schema/prompt, and retest. Do not add resolver queues, heuristic guardrails, local repair passes, reconciliation layers, or hidden fallback paths.
- Live annotation chunks are sequential, have a fixed run manifest and budget, and are never silently retried or promoted. A contract test must cover any change to the provider request, schema, or prompt.
- A candidate annotation schema/prompt must be benchmarked in isolation before it can replace the production contract. Every live benchmark names exactly one stored gold document, has an explicit page/request budget, checkpoints every returned chunk, and never mutates stored reviews or production behavior automatically.
- Required evidence is full verbatim manuscript text, exact quotes, or explicit source references. Summaries and representative snippets are prohibited.

## Change Safety

- Add a cached fixture and focused unit/browser test before adding a feature.
- Preserve the established UI when refactoring data or backend logic.
- Before deleting code, prove it is outside active entry-point import graphs and run the reader-shell regression test.

## Authoritative Manuscript Pipeline

- [docs/source-grounded-pipeline-v1-plan.md](docs/source-grounded-pipeline-v1-plan.md) is the accepted architecture and implementation plan for raw OCR, page-range annotations, document-index assembly, Document QnA linking, progressive UI state, and stored-review artifacts.
- [docs/reference-inventory-v1-decision.md](docs/reference-inventory-v1-decision.md) supersedes the retired Reference Audit V2 path. Its production request owns bibliography inventory only. The broad annotation contract owns exact body citation occurrences, and the bounded reference-relation stage may map only already validated citation and bibliography handles.
- Do not change its stage ownership, semantic boundaries, source requirements, call limits, or regression gates without explicit user approval and a superseding architecture decision document.
- Implement its numbered steps in order, with a focused test gate and rollback commit after each step. Do not combine later cleanup or feature work into a pipeline milestone.
