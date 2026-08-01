function handleSchema(handles = []) {
  return handles.length ? { type: 'string', enum: handles } : { type: 'string' };
}

export function referenceLinksFormat(candidates = {}) {
  const referenceHandles = (candidates.references || []).map((item) => item.handle).filter(Boolean);
  const citationHandles = (candidates.citation_mentions || []).map((item) => item.handle).filter(Boolean);
  return {
    type: 'json_schema',
    json_schema: {
      name: 'deskreview_reference_relation_decisions_v4',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['citation_decisions'],
        properties: {
          citation_decisions: citationHandles.length
            ? {
                type: 'array',
                minItems: citationHandles.length,
                maxItems: citationHandles.length,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['citation_handle', 'classification', 'reference_handles'],
                  properties: {
                    citation_handle: handleSchema(citationHandles),
                    classification: {
                      type: 'string',
                      enum: ['bibliographic_citation', 'not_bibliographic'],
                      description: 'Classify the candidate itself. Table or figure mentions, confidence intervals, statistical values, measurements, identifiers, and other non-citations are not_bibliographic.'
                    },
                    reference_handles: referenceHandles.length
                      ? { type: 'array', items: handleSchema(referenceHandles), description: 'Bibliography handles cited by this candidate. Empty when classification is not_bibliographic.' }
                      : { type: 'array', maxItems: 0, items: { type: 'string' } }
                  }
                }
              }
            : { type: 'array', maxItems: 0, items: { type: 'object' } }
        }
      }
    }
  };
}

export const referenceLinksPrompt = [
  'Classify every supplied source-grounded candidate exactly once, then map only genuine bibliographic citations to bibliography reference handles. Use only the supplied opaque handles, printed bibliography labels, reference text, citation text, and context. Never return or alter manuscript text, quotes, pages, block IDs, or candidates.',
  'When all nonempty bibliography printed_label values are numbers, the manuscript uses a numeric bibliography. In that case classify a candidate as bibliographic_citation only when citation_text itself is a numeric citation marker or group, such as a superscript number or range, a bracketed numeric list, or a parenthesized numeric list. Map strictly by those printed numbers. Never use topic or surrounding context to infer a numeric reference.',
  'Always classify table or figure mentions, confidence intervals, statistical values, measurements, grant or project numbers, trial registrations, DOI strings, software versions, dates, and numbered-list labels as not_bibliographic, with an empty reference_handles array. Examples include "(Table 2)", "(95% CI, 134.0-136.1)", and "Figure 3".',
  'For an unnumbered author-year style, resolve author-year, narrative, grouped, multi-year, et al., punctuation, accent, and minor printed author-form variations from citation_text and reference text. A grouped author-year citation may map to multiple references.',
  'Every citation handle must appear exactly once in citation_decisions. bibliographic_citation requires one or more reference_handles. not_bibliographic requires an empty reference_handles array. DeskReview derives uncited bibliography entries from the decisions. Return JSON only.'
].join(' ');

export function hasReferenceLinkCandidates(candidates = {}) {
  return Array.isArray(candidates.references)
    && Array.isArray(candidates.citation_mentions)
    && candidates.references.every((item) => item && typeof item.handle === 'string' && item.handle.trim() && typeof item.printed_label === 'string' && typeof item.text === 'string' && item.text.trim())
    && candidates.citation_mentions.every((item) => (
      item
      && typeof item.handle === 'string'
      && item.handle.trim()
      && typeof item.citation_text === 'string'
      && item.citation_text.trim()
      && item.source
      && typeof item.source.exact_quote === 'string'
      && item.source.exact_quote.trim()
    ));
}

function unique(values = []) {
  return Array.isArray(values) && new Set(values).size === values.length;
}

export function hasValidReferenceLinks(links = {}, candidates = {}) {
  const allowedKeys = new Set(['citation_decisions']);
  const references = new Set((candidates.references || []).map((item) => item.handle));
  const citations = new Set((candidates.citation_mentions || []).map((item) => item.handle));
  if (!links || typeof links !== 'object' || Array.isArray(links)) return false;
  if (!Object.keys(links).every((key) => allowedKeys.has(key))) return false;
  if (!Array.isArray(links.citation_decisions) || links.citation_decisions.length !== citations.size) return false;
  const decidedCitations = new Set();
  for (const decision of links.citation_decisions) {
    if (!decision || !citations.has(decision.citation_handle) || decidedCitations.has(decision.citation_handle)) return false;
    if (!['bibliographic_citation', 'not_bibliographic'].includes(decision.classification)) return false;
    if (!unique(decision.reference_handles) || !decision.reference_handles.every((handle) => references.has(handle))) return false;
    if (decision.classification === 'bibliographic_citation' && !decision.reference_handles.length) return false;
    if (decision.classification === 'not_bibliographic' && decision.reference_handles.length) return false;
    decidedCitations.add(decision.citation_handle);
  }
  return [...citations].every((handle) => decidedCitations.has(handle));
}

export function applyReferenceLinks(references = [], candidates = {}, links = {}) {
  const mentions = new Map((candidates.citation_mentions || []).map((item) => [item.handle, item]));
  const occurrences = new Map(references.map((item) => [item.link_handle, []]));
  (links.citation_decisions || []).filter((decision) => decision.classification === 'bibliographic_citation').forEach((decision) => {
    const mention = mentions.get(decision.citation_handle);
    if (!mention) return;
    decision.reference_handles.forEach((handle) => occurrences.get(handle)?.push({
      citation_text: mention.citation_text,
      context_quote: mention.context_quote || mention.source?.exact_quote || '',
      source_alignment: mention.source_alignment || 'exact',
      source: mention.source
    }));
  });
  return references.map((item) => ({ ...item, body_occurrences: occurrences.get(item.link_handle) || [] }));
}
