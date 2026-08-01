# Reference Relation Decisions v4

Status: active bounded relation contract
(`deskreview_reference_relation_decisions_v4`).

The request receives only source-grounded citation candidates and the validated
bibliography inventory. It never receives the PDF and cannot create or alter
source locations.

Mistral returns exactly one decision per candidate:

- `bibliographic_citation` with one or more bibliography handles; or
- `not_bibliographic` with no bibliography handles.

For numeric bibliographies, mappings must follow the printed numeric labels
only. Table and figure mentions, confidence intervals, statistical values,
measurements, identifiers, and similar non-citations must be classified as
`not_bibliographic`. The app passively validates decision completeness, handle
membership, and the classification/reference-handle cardinality contract.

The first bounded medRxiv acceptance run used one relation call over cached
candidates. It correctly mapped 24 genuine citation occurrences, classified
three false candidates as non-bibliographic, and covered all 22 bibliography
entries. One additional false table candidate had already failed exact-source
validation and never entered the relation request.
