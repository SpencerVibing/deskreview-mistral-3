# Cached Gold Fixture Acceptance

Status: Step 10 local acceptance baseline.

These assertions run only against immutable cached stored-review payloads under
`public/data/stored/`. They do not call Mistral and they do not regenerate,
rewrite, repair, or reconcile fixture data.

## Current Preprint Baseline

| Fixture | Pages | Authors | Affiliations | Keywords | References | Tables | Figures | Required late coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `medrxiv` | 24 | 23 | 11 | 0 | 22 | 3 | 1 | `Conclusions` |
| `chemrxiv` | 32 | 5 | 6 | 3 | 63 | 1 | 4 | `Outlook` |
| `eartharxiv` | 19 | 3 | 3 | 3 | 47 | 0 | 3 | `2.3.1 Radon transport` |
| `researchsquare` | 13 | 8 | 1 | 5 | 29 | 3 | 3 | `DISCUSSION` |
| `psyarxiv` | 34 | 2 | 1 | 6 | 64 | 6 | 1 | `5. Conclusion` |

## Relation-Link Baseline

The current cached preprint payloads do not include stored source-link relation
payloads or populated `body_occurrences`. Step 10 records that as explicit
baseline evidence instead of letting missing links masquerade as successful
links. A future approved live run must add relation payloads before these
fixtures can be promoted from count/anchor acceptance to full relation
acceptance.

## Anchor Baseline

Direct source-anchor coverage is recorded separately from counts. This prevents a
correct count from hiding stale or invalid stored anchors.
