# Source-Grounded Manuscript Pipeline V1

Status: Accepted implementation plan; not yet implemented.

This document is the authoritative plan for the DeskReview Mistral-3 manuscript
pipeline. It exists to prevent implementation drift, manuscript-specific fixes,
semantic repair layers, and regressions caused by partial annotation results.

Changing a non-negotiable decision in this document requires:

1. An explicit user-approved architecture change.
2. A superseding architecture decision document.
3. Cached-fixture regression evidence before any live API run.
4. A separate rollback commit.

## Problem being solved

The current psyArXiv result exposes two architectural failure modes:

- Only 14 bibliography entries became structured results even though the raw OCR
  contains approximately 64 references.
- Article text from later pages, including the Conclusion, was not included in
  the final word count.

These symptoms indicate that partial annotation results can currently be treated
as complete, overwritten by another range, or projected into the UI before all
required ranges have been accepted. The fix must address those classes of error.
It must not add manuscript-specific parsing or repair code.

## Non-negotiable architecture

### Stage 1: one immutable raw OCR result

- Send the complete PDF through one raw OCR request.
- Store the returned pages, blocks, Markdown, tables, figures, images, and
  geometry unchanged.
- Use this result immediately for the reader, HTML rendering, ToC, tables, and
  figures.
- Never rewrite raw OCR data in a later stage.
- Never derive semantic counts from raw OCR formatting alone.

### Stage 2: source-grounded document annotations

- Process the manuscript in explicit annotation windows of at most eight pages.
- Use one fixed, versioned JSON Schema and one fixed, versioned base prompt.
- Return compact source structure rather than summaries or duplicated document
  text.
- Extract all relevant entities visible in each window:
  - authors, affiliations, explicit author-affiliation relationships;
  - abstract, keywords, section headings, and complete article-body block ranges;
  - every individual bibliography entry;
  - every visible body citation group;
  - every table or figure candidate;
  - every visible table or figure mention.
- Require every item to carry its OCR page, source block or block range, and an
  exact verbatim quote.
- Do not impose a small `maxItems` limit on bibliography entries or mentions.
- Do not ask Mistral to calculate article or abstract word counts. Mistral selects
  exact OCR source blocks; DeskReview counts the exact returned OCR text.

### Annotation-window boundary policy

- Each manuscript page has exactly one owning annotation window.
- A boundary page may be supplied to the next window as read-only context when
  needed to preserve an item that crosses a page boundary.
- The source page determines which window owns an item.
- Context overlap must never trigger content-based deduplication, reconciliation,
  or semantic selection.
- Every window and every owned page must be recorded in a fixed run manifest
  before the first annotation call.

### Stage 3: mechanical document index assembly

- Accept only schema-valid, source-valid annotation chunks.
- Confirm that every returned page exists, every source block exists, and every
  exact quote occurs in its declared source.
- Append accepted entities from all owning windows.
- Preserve source order using returned page and source position.
- Use source-position handles for identity inside the combined index.
- Never use a user-visible label such as `Reference 6` as an identity.
- Never infer, split, merge, repair, normalize, rank, or choose semantic items.
- Do not publish a final article or reference count until all required annotation
  windows have completed successfully.
- Preserve failed chunks and expose an unavailable state. Do not silently repair
  or retry them with changed prompts.

### Stage 4: bounded Document QnA relational linking

- Run only after the combined source-anchored index is complete.
- Give Document QnA the already anchored candidates:
  - bibliography handles and exact bibliography text;
  - citation-occurrence handles and exact occurrence text;
  - table/figure handles and captions;
  - display-mention handles and exact mention text.
- Ask it only to return:
  - citation occurrence handle to bibliography handle relationships;
  - display mention handle to table/figure handle relationships.
- It must not return, replace, or invent pages, blocks, coordinates, or quotes.
- Reject relationships containing unknown handles.
- A linking failure affects occurrence links only. It must never alter counts,
  extracted entities, direct item anchors, or article text.
- No hidden follow-up, repair, adjudication, or fallback model calls are allowed.

### Stage 5: UI projection and storage

- Keep one explicit state per result category:
  `waiting`, `extracting`, `counted`, `linking`, `ready`, or `unavailable`.
- Show partial progress as partial progress, never as a finished result.
- Tables and figures may appear from raw OCR before annotation finishes.
- Authors, affiliations, abstract, and keywords may appear when their owning
  annotation range is accepted.
- Article and reference counts become final only when all required ranges are
  accepted.
- Source-link preparation never blocks an already verified count.
- Store raw OCR, annotation chunks, the combined index, Document QnA relations,
  runtime events, and their contract versions as immutable review artifacts.
- Reopening a stored review must not recalculate or overwrite its original run.

## Step-wise implementation plan

Each step ends with a focused test gate and a separate rollback commit. A later
step must not start while the preceding gate is failing.

### Step 0: freeze the current behavior

Deliverables:

- Record the current production entry points and active import graph.
- Identify every function that can produce article counts, reference counts,
  annotation chunk assembly, source links, or formatted bibliography output.
- Mark current cached OCR, annotation, and QnA payloads as immutable fixtures.
- Record the known psyArXiv expectations, including its complete bibliography and
  the presence of Discussion and Conclusion.

Gate:

- No runtime behavior changes.
- A file-level ownership inventory exists.

### Step 1: establish contract ownership

Deliverables:

- Designate one schema/prompt module as the only annotation contract owner.
- Designate one service as the only annotation request owner.
- Designate one pure core module as the only chunk-assembly owner.
- Designate one service and one contract module as the only Document QnA owners.
- Designate one browser state module as the only pipeline-state owner.

Gate:

- An automated architecture test can identify duplicate contract or request
  owners.
- No UI module performs provider calls or semantic extraction.

### Step 2: finalize the annotation contract

Deliverables:

- Define exhaustive arrays for bibliography entries, citation groups, displays,
  display mentions, front matter, and article source ranges.
- Require exact source locations for every item.
- Remove small array caps and model-authored word-count fields.
- Encode bibliography continuation, line numbering, repeated headers and
  footers, cover sheets, and multi-entry OCR blocks in the prompt.
- Version and hash the schema and prompt together.

Gate:

- Cached valid and invalid annotation payloads exercise every required field.
- The contract rejects missing sources without modifying the response.

### Step 3: make annotation coverage explicit

Deliverables:

- Create the complete annotation run manifest before processing begins.
- Give every page one owner.
- Record context-only boundary pages separately.
- Track each chunk independently without allowing one chunk to finalize another.

Gate:

- Tests cover documents shorter than eight pages, exactly eight pages, multiple
  ranges, a final partial range, and a bibliography crossing a boundary.
- No missing or multiply owned page can produce a final count.

### Step 4: replace chunk merging with mechanical assembly

Deliverables:

- Append accepted items from every owning range.
- Use source-position identities.
- Preserve exact model-returned values and source order.
- Keep incomplete categories unavailable rather than manufacturing fallbacks.

Gate:

- The cached psyArXiv fixture retains every bibliography entry from every range.
- Reordering response arrival does not change the combined result.
- No range can overwrite an earlier range's arrays.

### Step 5: make word counts reproducible

Deliverables:

- Build abstract and article text only from model-selected raw OCR blocks.
- Count the exact reconstructed text with one documented tokenizer.
- Store the selected block IDs and counted text provenance.
- Keep section headings separate from article-body block ownership.

Gate:

- The psyArXiv article source includes Discussion and Conclusion.
- Recounting the same selected blocks produces the same number.
- No representative snippet can satisfy the word-count contract.

### Step 6: make bibliography rendering independent from OCR block shape

Deliverables:

- Render each model-returned bibliography entry as one UI item.
- Bind each item to its exact quote within its raw OCR source block.
- Allow multiple virtual entry anchors inside one large OCR block.
- Keep UI numbering separate from semantic identity.

Gate:

- A single OCR block containing many references renders as separate entries.
- Each reference jump highlights only its exact source text.
- Rendering does not affect the reference count.

### Step 7: constrain Document QnA to relations

Deliverables:

- Build one immutable candidate packet from the accepted document index.
- Return handle-to-handle mappings only.
- Validate mappings passively against the candidate packet.
- Keep reference and display-link statuses independent from count statuses.

Gate:

- Unknown or malformed handles fail closed.
- QnA failure leaves all counts and direct anchors unchanged.
- Cached relations produce stable links regardless of UI rendering order.

### Step 8: implement progressive state presentation

Deliverables:

- Drive every tile and details panel from the explicit category state.
- Distinguish partial counts, final counts, link preparation, and unavailable
  links.
- Prevent a partial reference count from appearing final.
- Record all state transitions in the runtime summary.

Gate:

- Browser tests cover out-of-order annotation completion and failed linking.
- No category displays `ready` before its required artifacts exist.

### Step 9: remove superseded paths

Deliverables:

- Produce a deletion manifest.
- Remove duplicate annotation contracts, old merge paths, semantic fallbacks,
  repair logic, alternate reference parsers, and redundant source-link resolvers.
- Preserve the established reader UI and stored-review format through one stable
  adapter where migration is required.

Gate:

- Active import-graph proof shows deleted files are unused.
- Core, UI, server, and stored-review regression suites pass.
- The codebase has one path for each pipeline responsibility.

### Step 10: cached gold-set acceptance

Deliverables:

- Run the complete pipeline projection against immutable cached fixtures.
- Start with psyArXiv, then process one gold manuscript at a time.
- Record expected counts, section coverage, exact anchors, and relation mappings.

Gate:

- A prompt/schema or assembly change cannot be accepted if any previously passing
  fixture regresses.
- No manuscript-specific runtime branch exists.

### Step 11: one live acceptance run

Deliverables:

- Obtain explicit approval for one live psyArXiv run.
- Fix the contract version, page manifest, request budget, and stop conditions
  before starting.
- Store every raw response and runtime event without overwriting cached fixtures.

Gate:

- Reference count, complete article text, exact direct anchors, and relational
  links meet the recorded acceptance criteria.
- Any unexpected retry, repair path, authentication failure, or budget breach
  stops the run immediately.

### Step 12: sequential gold-set promotion

Deliverables:

- Run remaining manuscripts one at a time only after psyArXiv passes.
- Treat failures as contract evidence.
- Improve only the generic schema or prompt, then rerun all cached fixtures before
  another live request.

Gate:

- Production promotion requires all cached fixtures and approved live acceptance
  cases to pass under one contract version.

## Regression-prevention provisions

The implementation must add these enforcement mechanisms:

1. Architecture decision lock: this document may be superseded only with explicit
   user approval and a replacement decision record.
2. Contract hash: stored runs record the annotation schema, prompt, QnA contract,
   and projection versions.
3. Single-owner tests: CI fails when another annotation request, merge path,
   word-count producer, or source-link resolver is introduced.
4. Immutable fixtures: cached provider payloads are never regenerated by tests.
5. Gold assertions: counts, section coverage, sources, and links are tested
   separately so one success cannot hide another failure.
6. No manuscript branching: CI scans active runtime code for fixture names,
   filenames, manuscript titles, and gold-set-specific conditions.
7. No semantic middleware: validators may reject but never mutate, repair, retry,
   or substitute provider output.
8. No partial finalization: category state cannot become `ready` until its
   required range coverage is complete.
9. No silent prompt edits: schema or prompt changes require a contract-version
   change and cached-fixture test results.
10. One-manuscript live budget: benchmarking defaults to one explicitly named
    manuscript and stops at its fixed request/page limit.
11. Rollback points: every numbered implementation step is committed separately.
12. Stored-review immutability: opening a review cannot invoke analysis or replace
    its original runtime summary.

These controls cannot make architectural change technically impossible, but they
make accidental drift visible and cause automated checks to fail. Deliberate
change requires an explicit, reviewable decision.
