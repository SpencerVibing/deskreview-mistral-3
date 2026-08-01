# Body Citation Annotation v9

Status: historical. Replaced by `deskreview_body_citations_v10`.

The exact raw-OCR anchor is limited to 3-6 consecutive ordinary words beside
the citation. It must exclude the citation marker and may not add, paraphrase,
or normalize words. Citation exclusions for grants, project identifiers, trial
registrations, DOIs, software versions, dates, measurements, statistics, and
numbered lists are present in both the field schema and the prompt.

Packets contain at most eight model-selected OCR article blocks and split only
at original page boundaries. This reduces cross-page ownership errors while
preserving non-overlapping, bounded requests.
