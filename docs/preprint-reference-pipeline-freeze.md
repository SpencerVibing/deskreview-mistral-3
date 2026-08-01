# Preprint Reference Pipeline Freeze

Status: expanded regression baseline on 2026-07-31.

This checkpoint protects the reference path across all five stored preprint
fixtures and retains the live psyArXiv relation evidence verified with
`Age, Experience, Gender, and Dangerous Driving Behavior.pdf`.

## Accepted live evidence

- 64 bibliography entries were presented.
- The bounded replay returned 33 body-citation groups.
- Exact-source validation accepted 29 groups and rejected 4.
- Document QnA returned 29 valid citation mappings.
- No accepted citation handle was left unmatched.
- The reader displayed body-text occurrences per mapped bibliography entry
  instead of the unavailable state.

The four rejected groups failed closed because their returned label was not
contained in the returned context or the context was not unique in raw OCR.
They were not repaired or substituted.

## Enforcement

`tests/preprint-reference-freeze.test.mjs`:

1. Pins bibliography counts and the presence of raw OCR bibliography blocks for
   medRxiv, chemRxiv, EarthArXiv, Research Square, and psyArXiv.
2. Keeps the cached psyArXiv baseline at 34 OCR pages and 64 references.
3. Requires late psyArXiv article coverage through `5. Conclusion`.
4. Verifies a real grouped psyArXiv citation against its exact cached OCR block.
5. Verifies handle-only relation mapping and occurrence projection without
   changing the bibliography inventory.
6. Requires the block-keyed bibliography response to cover every supplied block
   exactly once, including continuation-only blocks.
7. Verifies that missing blocks and model-normalized quotes fail closed and
   remain observable instead of silently changing source evidence.
8. Pins the bibliography, body-citation, and reference-relation request
   contracts by version and SHA-256 digest.

The test uses immutable cached data and makes no Mistral calls. Any intentional
prompt or schema change must:

1. Increment the relevant contract version.
2. Pass all cached tests.
3. Run one explicitly approved live manuscript acceptance test.
4. Record the new evidence and update the digest in a reviewable commit.

Do not update a failing digest merely to make the test pass.
