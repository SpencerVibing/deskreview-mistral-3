# Body Citation Annotation v13

Status: rejected bounded experiment; production remains on
`deskreview_body_citations_v10`.

This third bounded experiment separates responsibilities:

- citation annotation copies complete `verbatim_source_span` values from the
  supplied raw OCR block packet;
- reference relation v4 decides whether each grounded span is bibliographic and
  which bibliography handles it maps to.

The source-span stage does not normalize citation styles or perform bibliography
matching. Passive exact-substring validation remains unchanged.

The five-call psyArXiv/EarthArXiv acceptance run failed because the provider
continued stripping group delimiters, normalizing raw OCR typography, and
returning citations outside supplied block boundaries. This contract was not
promoted to production.
