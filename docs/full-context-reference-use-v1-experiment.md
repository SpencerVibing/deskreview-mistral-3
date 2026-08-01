# Full-context Reference-use v1 Experiment

Status: failed strict acceptance; not integrated into production.

## Scope

- manuscript: cached psyArXiv gold manuscript;
- provider calls: one `mistral-large-2512` chat-completions call;
- input: 47 cached model-selected raw OCR article blocks and 64 stored
  bibliography entries;
- no OCR, Document Annotation, focused citation extraction, bibliography, or
  relation calls;
- contract: `deskreview_full_context_reference_use_v1`.

The model returned each physical citation group with a raw OCR block ID, exact
quote, and all cited bibliography handles. It also returned an uncited-handle
list. DeskReview validated the response passively without relocation or repair.

## Result

- elapsed time: 41.3 seconds;
- prompt tokens: 17,045;
- completion tokens: 3,699;
- returned physical citation groups: 36;
- returned mapped uses: 135, compared with the 133-use gold result;
- references covered before source validation: 64/64;
- source-grounded groups after exact validation: 30/36;
- source-grounded mapped uses: 127;
- references still covered after exact validation: 64/64.

Strict acceptance failed because six occurrences used a normalized quote or an
incorrect OCR block. The model also listed 28 already-covered references as
uncited, contradicting its own occurrence mappings.

## Conclusion

The full-context model understood the bibliography relationships materially
better than focused Document Annotation and retained at least one grounded use
for every bibliography entry. It did not reliably produce complete occurrence
counts or exact source locations in the same global output.

A possible v2 experiment would remain one full-context call but use block-keyed
output: exactly one result per supplied OCR article block, with occurrences and
reference handles nested under that block. It would omit the model-authored
uncited list; DeskReview can derive the complement of returned reference handles
without changing any semantic answer. This requires separate explicit approval
before another manuscript-content call.

Immutable result:
`data/benchmarks/psyarxiv-full-context-reference-use-1785591220838.json`.
