# Full-context Reference-use v2 Experiment

Status: failed strict acceptance; not integrated into production.

## Scope

- one explicitly authorized `mistral-large-2512` call;
- cached psyArXiv raw OCR, cached article-block selection, and stored 64-entry
  bibliography;
- exactly one schema result per each of 47 supplied article blocks;
- citation occurrences nested under their fixed block result;
- no model-authored uncited-reference list;
- no OCR or Document Annotation calls.

## Result

- elapsed time: 58.7 seconds;
- prompt tokens: 17,066;
- completion tokens: 4,319;
- block contract: 47/47 complete and in order;
- bibliography coverage: 64/64 references;
- returned physical citation groups: 34;
- returned mapped uses: 135, compared with the 133-use gold result;
- exact-source failures: 6.

Three failures were punctuation or grouping transformations inside the correct
block. Three other citations were returned under blocks that did not contain
them at all. Therefore block-keyed output removed global ID selection and the
contradictory uncited list, but did not prevent source hallucination.

The experiment did not modify production. Immutable result:
`data/benchmarks/psyarxiv-full-context-reference-use-v2-1785592789243.json`.
