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
- Structured manuscript data is a separate annotation stage and must send both `document_annotation_format` and `document_annotation_prompt` with the PDF in its OCR request. The raw and annotation stages must remain visibly distinct in the UI.
- Every structured manuscript analysis must send both `document_annotation_format` and `document_annotation_prompt` with the PDF in that OCR request. The format is the authoritative JSON Schema; the prompt contains document-specific extraction instructions.
- Require a source for every schema item: returned page identifier, an exact verbatim quote, and an OCR block/coordinate reference when Mistral returns one. Require complete verbatim section text whenever the product displays or counts that section.
- Put all handling of messy formatting in the annotation prompt: line numbering, repeated headers/footers, cover sheets, tables, figures, front matter, bibliography continuations, and source locations. Improve the schema/prompt when quality fails.
- Never infer, repair, reconcile, synthesize, split, merge, rank, or guess manuscript structure locally. Do not use chat/completion calls to recreate structure requested through document annotation.
- Deterministic code may validate the schema, render model-returned values, and bind an exact returned source reference to returned OCR content. It must never change a model-authored answer or fabricate a fallback.
- An incomplete, slow, invalid, or unlinked annotation is an annotation-contract failure. Cache the failing response, improve the JSON schema/prompt, and retest. Do not add resolver queues, heuristic guardrails, local repair passes, reconciliation layers, or hidden fallback paths.
- Required evidence is full verbatim manuscript text, exact quotes, or explicit source references. Summaries and representative snippets are prohibited.

## Change Safety

- Add a cached fixture and focused unit/browser test before adding a feature.
- Preserve the established UI when refactoring data or backend logic.
- Before deleting code, prove it is outside active entry-point import graphs and run the reader-shell regression test.
