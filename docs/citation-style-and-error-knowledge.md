# Citation Style and Error Knowledge

## Purpose

This document is a product and prompt-design reference for:

- recognizing the common ways bibliography entries and body citations appear;
- mapping a source-grounded body citation to one or more bibliography entries;
- describing possible citation-quality issues after a relationship is established;
- designing immutable regression fixtures for citation extraction and mapping.

It is knowledge, not executable manuscript parsing logic. DeskReview must continue
to preserve model-returned manuscript text and exact source anchors. It must not
silently correct, normalize, split, merge, or replace manuscript content.

## Sources

- [Scribbr citation styles guide](https://www.scribbr.com/citing-sources/citation-styles/)
- [Scribbr citation-check report example](https://techademia.scribbr.com/check/2b14db4b-8482-4f58-9ce5-359a3a142fbe/report/latest/details)
- Error examples transcribed by the DeskReview project owner on 2026-07-30.

The style guide groups citation systems into three broad families:

1. Author-based parenthetical or narrative citations.
2. Numerical citations.
3. Note citations in footnotes or endnotes.

Rules such as punctuation, ordering, conjunctions, and use of `et al.` depend on
the selected citation style. They must not be treated as universal unless the
manuscript's required style is known.

## Separate Mapping From Style Diagnosis

Citation mapping and citation-style diagnosis are different tasks.

### Mapping

Mapping asks:

> Which bibliography entry or entries does this exact body citation refer to?

Minor formatting or author-form errors should not automatically prevent a likely
relationship from being returned. For example, `(Brown 2008)` may still map to
Brown (2008), while retaining the exact printed citation for later review.

### Style diagnosis

Style diagnosis asks:

> Given the required citation style, what is wrong with the printed citation?

The mapping result must remain source-grounded even when a possible error is
reported. A style diagnosis must never overwrite the observed citation.

## Citation Forms To Recognize

### Author-based forms

- Parenthetical author-year: `(Brown, 2008)`
- Narrative author-year: `Brown (2008)`
- Two authors: `(Veryzer & Borja de Mozota, 2005)`
- Narrative two authors: `Veryzer and Borja de Mozota (2005)`
- Three or more authors: `(Franke et al., 2006)`
- Corporate author: `(World Health Organization, 2023)`
- Multiple years: `(Smith, 2019, 2021)`
- Year suffixes: `(Smith, 2020a, 2020b)`
- No date: `(Jong, n.d.)`
- Author-page: `(Davidson 155)`
- Grouped sources: `(Mitchell & Dacin, 1996; Park et al., 1994)`

### Numerical forms

- Bracketed number: `[1]`
- Parenthesized number: `(1)`
- Superscript number
- Lists: `[1, 3, 5]`, `[1; 3; 5]`
- Inclusive ranges: `[37-42]`
- Combined lists and ranges: `[1, 3-5, 8]`

Numerical labels refer to bibliography entries by the numbering system selected
by the manuscript. A citation range represents every included number.

### Note forms

- Superscript footnote or endnote markers
- Full source details in a note
- Shortened repeat notes
- Author-title or title-only shortened notes

Do not assume that every superscript number is a bibliography citation. It may be
an author-affiliation marker, table note, mathematical exponent, or ordinary
footnote.

## Possible Error Library

The following identifiers are stable candidates for future prompt outputs,
diagnostic UI, or test fixtures. They are not enabled product behavior merely
because they are documented here.

### Punctuation and spacing

| Error code | Meaning | Observed | Possible expected form |
| --- | --- | --- | --- |
| `missing_author_year_comma` | Required comma between author and year is absent | `(Brown 2008)` | `(Brown, 2008)` |
| `incorrect_spacing` | Spaces around punctuation or conjunctions are missing or misplaced | `(Veryzer&Borja de Mozota,2005)` | `(Veryzer & Borja de Mozota, 2005)` |
| `incorrect_parentheses` | Parentheses are missing, duplicated, or unbalanced | `((Brown, 2008)` | `(Brown, 2008)` |
| `incorrect_group_separator` | Sources in one group use the wrong separator | `(Mascitelli, 2000: Buchenau et al., 2000)` | Semicolon-separated sources |
| `incorrect_page_locator` | A page or location indicator has the wrong form | Style-dependent | Style-dependent |

### Author presentation

| Error code | Meaning | Observed | Possible expected form |
| --- | --- | --- | --- |
| `misspelled_author` | Printed author name differs from the matched bibliography entry | `Boger and Horst (2013)` | `Bogers and Horst (2013)` |
| `author_set_mismatch` | Citation omits, adds, or substitutes an author outside the style's abbreviation rules | `Schreier (2008)` | `Schreier and Prügl (2008)` |
| `et_al_incorrect` | `et al.` is used where the style expects named authors | `(Buchenau et al., 2000)` | `(Buchenau & Fulton Suri, 2000)` |
| `et_al_required` | Named authors are used where the style expects `et al.` | `(Franke, Hippel, & Schreier, 2006)` | `(Franke et al., 2006)` |
| `et_al_malformed` | The abbreviation is punctuated incorrectly | `(Smith et al, 2019)` | `(Smith et al., 2019)` |
| `incorrect_ampersand` | Ampersand is used where the style expects a word | `Veryzer & Borja de Mozota (2005)` | `Veryzer and Borja de Mozota (2005)` |
| `ampersand_required` | A word is used where the style expects an ampersand | `(Schreier and Prügl, 2008)` | `(Schreier & Prügl, 2008)` |

### Date presentation

| Error code | Meaning | Observed | Possible expected form |
| --- | --- | --- | --- |
| `year_mismatch` | Citation year differs from the matched bibliography entry | `(Thomke, 1989)` | `(Thomke, 1998)` |
| `no_date_malformed` | No-date abbreviation has the wrong punctuation | `(Jong, nd.)` | `(Jong, n.d.)` |
| `year_suffix_mismatch` | Same-author same-year suffix differs from the bibliography | `(Smith, 2020a)` | Style and bibliography dependent |

### Citation groups

| Error code | Meaning |
| --- | --- |
| `citation_group_separator` | Sources in a group are not separated according to the required style. |
| `citation_group_order` | Sources in a group are not ordered according to the required style. |
| `citation_group_partial_match` | Only some members of a citation group map to bibliography entries. |
| `numeric_range_partial_match` | One or more numbers in a numeric range have no bibliography entry. |

Group-level and member-level errors may coexist. For example, a group can have
the wrong order while one member also has a missing author-year comma.

### Relationship and inventory problems

| Error code | Meaning |
| --- | --- |
| `source_missing_from_reference_list` | A body citation cannot be matched to any bibliography entry. |
| `reference_not_cited` | A bibliography entry has no detected body citation. |
| `duplicate_reference_entry` | Two bibliography entries appear to describe the same source. |
| `ambiguous_reference_match` | More than one bibliography entry remains plausible for a citation. |

`duplicate_reference_entry` is a semantic judgment and must come from an
explicit model-authored analysis stage. Local code must not infer it through
string similarity.

## Prompt Guidance

The relation prompt should contain a concise version of the following:

> Map each exact, source-grounded body citation occurrence to the supplied
> bibliography handles. Account for author-year, narrative, grouped, numerical,
> ranged, superscript, and note forms. Allow minor printed differences in
> punctuation, spacing, accents, hyphenation, `et al.`, author spelling, and year
> when the intended source remains clear. Return only opaque handles. Do not
> correct or rewrite the manuscript. Leave genuinely ambiguous or unmatched
> occurrences unmatched.

If citation-quality diagnostics are later introduced, use a separate explicit
stage or output field:

> After mapping, report possible errors using only the allowed error codes.
> Preserve `observed_exact_quote`. Provide `expected_display` only when the
> required citation style is known. Do not report style-dependent punctuation,
> ordering, conjunction, or `et al.` rules as universal errors.

The full knowledge document should not be inserted into every API request.
Prefer a concise prompt taxonomy and a small number of representative examples.

## Candidate Diagnostic Shape

This is a design reference, not an active API contract:

```json
{
  "citation_handle": "opaque-citation-handle",
  "reference_handles": ["opaque-reference-handle"],
  "status": "matched_with_possible_issues",
  "possible_issues": [
    {
      "code": "missing_author_year_comma",
      "observed_exact_quote": "(Brown 2008)",
      "expected_display": "(Brown, 2008)",
      "style_basis": "APA 7"
    }
  ]
}
```

Permitted relationship statuses could be:

- `matched`
- `matched_with_possible_issues`
- `ambiguous`
- `unmatched`

`expected_display` and `style_basis` should be nullable. Exact source anchors
belong to the citation inventory created before relation mapping and should not
be regenerated by the relation model.

## Regression Fixture Matrix

Add immutable fixtures before expanding production prompts:

1. Clean author-year parenthetical and narrative citations.
2. Two citation groups in one sentence.
3. Grouped author-year citations with multiple matched references.
4. Numerical lists and inclusive ranges.
5. Superscript numerical citations.
6. Corporate authors.
7. Multiple works by one author, including year suffixes.
8. No-date sources.
9. Accented, hyphenated, and multi-part surnames.
10. Minor punctuation and spacing errors that should still map.
11. Misspelled author with a uniquely plausible bibliography entry.
12. Wrong year with a uniquely plausible bibliography entry.
13. Ambiguous author/year mismatch that must remain unmatched.
14. Body citation missing from the bibliography.
15. Bibliography entry never cited in the body.
16. Duplicate bibliography entry returned by an explicit model stage.
17. Footnote marker that is not a bibliography citation.
18. Superscript author-affiliation marker that is not a citation.

Each fixture should preserve:

- the exact body citation;
- its complete source sentence or note;
- the bibliography entries;
- the expected opaque relationships;
- expected unmatched handles;
- optional style-specific issue labels.

Tests should assess extraction, relationship mapping, and optional style
diagnosis separately so a formatting warning cannot invalidate an otherwise
correct source relationship.
