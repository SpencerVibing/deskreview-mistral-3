# Body Citation Annotation v8

Status: historical contract (`deskreview_body_citations_v8`). The active contract is documented in `body-citation-annotation-v9.md`.

This contract retains the v7 separation between visible `citation_text` and
raw-OCR `citation_anchor_text`. It additionally requires the exact OCR anchor
to contain ordinary adjacent words only, excluding the citation marker and its
attached spacing or punctuation. This prevents PDF typography normalization
from invalidating a real source location.

The focused inventory explicitly excludes grant, project, funding, trial
registration, software-version, date, measurement, statistical, and numbered
list identifiers. Passive source checks and bounded relation mapping remain
unchanged.
