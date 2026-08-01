# Citation Anchor Alignment v1

Status: active presentation-only source alignment.

The body-citation inventory remains provider-authored through Mistral Document
Annotation. The compact relation stage remains
`deskreview_reference_relation_decisions_v4`. This change adds no model call
and makes no semantic citation-to-reference decision.

## Contract

1. Use the model-returned citation text when it is a literal substring of the
   declared raw OCR block.
2. Otherwise, compare Unicode letter and number tokens inside that same block.
   Ignore only presentation differences in punctuation, delimiters,
   whitespace, case, and hyphen/dash separators.
3. Accept only one unique contiguous token sequence. Preserve token order,
   words, numbers, and diacritics.
4. Use the matched literal OCR substring as the HTML jump-link anchor while
   preserving the model-returned citation text as relation input.
5. Fail closed when the match is absent, repeated, crosses blocks, changes a
   word/number/diacritic, or selects one member from a larger citation group.

## Cached-fixture replay

No live API call was used for this test.

- psyArXiv: two of three previously rejected presentation variants aligned.
  The standalone Dula citation remained unavailable because the OCR source
  contained it only inside a larger grouped citation.
- EarthArXiv: two of three previously rejected presentation variants aligned.
  The standalone Sorokin citation remained unavailable for the same reason.

The unresolved cases are intentional. Splitting a model-authored citation
group would be a semantic repair and is outside this contract.
