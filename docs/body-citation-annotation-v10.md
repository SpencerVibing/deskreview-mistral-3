# Body Citation Annotation v10

Status: active focused extraction contract (`deskreview_body_citations_v10`).

Each bounded request supplies at most eight model-selected raw OCR article
blocks. Mistral returns exactly one result per supplied block and only the
complete citation marker or group copied character-for-character from that raw
OCR block.

DeskReview passively verifies that every returned marker exists in its declared
block and that the response does not return more identical occurrences than the
block contains. It does not parse, relocate, normalize, deduplicate, or repair a
citation. The declared OCR block remains the complete display context, while the
exact marker is the HTML navigation anchor and the relation-stage input.
