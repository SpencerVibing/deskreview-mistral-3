# Reference Audit V2 Deletion Manifest

The following files belong exclusively to the retired full-document reference
completion stage and are not used by any remaining entry point after the
production imports, endpoint, browser state, build list, and package scripts
are removed:

- `core/reference-audit.js`
- `services/mistral-reference-audit.js`
- `scripts/live-acceptance-psyarxiv-reference-audit-v2.mjs`
- `tests/reference-audit.test.mjs`
- `docs/reference-audit-v2-implementation-plan.md`

Cached provider responses under `data/` are retained as immutable historical
evidence. Stored reviews are not rewritten.
