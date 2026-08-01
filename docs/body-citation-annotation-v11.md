# Body Citation Annotation v11

Status: rejected bounded experiment; production remains on
`deskreview_body_citations_v10`.

This contract retains the v10 block-keyed, exact-copy design and changes only
three proven failure points:

- a parenthetical group is one indivisible occurrence and must be copied from
  its opening delimiter through its closing delimiter;
- a narrative citation must retain its printed narrative form and must never be
  rewritten as a parenthetical author-year citation;
- `citation_text` permits up to 800 characters so a valid long citation group
  cannot be truncated by the JSON Schema.

DeskReview continues to validate passively that every returned citation is a
literal substring of its declared immutable raw OCR block. It does not split,
normalize, relocate, or repair the provider response. Relation v4 is unchanged.
