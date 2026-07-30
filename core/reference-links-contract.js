function handleSchema(handles = []) {
  return handles.length ? { type: 'string', enum: handles } : { type: 'string' };
}

export function referenceLinksFormat(candidates = {}) {
  const referenceHandles = (candidates.references || []).map((item) => item.handle).filter(Boolean);
  const citationHandles = (candidates.citation_mentions || []).map((item) => item.handle).filter(Boolean);
  const handleArray = (handles) => handles.length
    ? { type: 'array', items: handleSchema(handles) }
    : { type: 'array', maxItems: 0, items: { type: 'string' } };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'deskreview_reference_relation_mappings_v2',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['citation_mappings', 'unmatched_citation_handles'],
        properties: {
          citation_mappings: citationHandles.length && referenceHandles.length
            ? {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['citation_handle', 'reference_handles'],
                  properties: {
                    citation_handle: handleSchema(citationHandles),
                    reference_handles: { type: 'array', minItems: 1, items: handleSchema(referenceHandles) }
                  }
                }
              }
            : { type: 'array', maxItems: 0, items: { type: 'object' } },
          unmatched_citation_handles: handleArray(citationHandles)
        }
      }
    }
  };
}

export const referenceLinksPrompt = [
  'Map each supplied source-grounded body citation occurrence handle to the bibliography reference handles it cites. Use only the supplied opaque handles and text. Never return or alter manuscript text, quotes, pages, block IDs, or candidates.',
  'Resolve numeric, author-year, narrative, grouped, multi-year, et al., punctuation, accent, and minor printed author-form variations from the supplied citation text and context. A grouped citation may map to multiple references.',
  'Every citation handle must appear exactly once, either in citation_mappings or unmatched_citation_handles. Do not return a separate list of uncited references; DeskReview derives that exact complement from the mappings. Return JSON only.'
].join(' ');

export function hasReferenceLinkCandidates(candidates = {}) {
  return Array.isArray(candidates.references)
    && Array.isArray(candidates.citation_mentions)
    && candidates.references.every((item) => item && typeof item.handle === 'string' && item.handle.trim() && typeof item.text === 'string' && item.text.trim())
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
  const allowedKeys = new Set(['citation_mappings', 'unmatched_citation_handles']);
  const references = new Set((candidates.references || []).map((item) => item.handle));
  const citations = new Set((candidates.citation_mentions || []).map((item) => item.handle));
  if (!links || typeof links !== 'object' || Array.isArray(links)) return false;
  if (!Object.keys(links).every((key) => allowedKeys.has(key))) return false;
  if (!Array.isArray(links.citation_mappings) || !unique(links.unmatched_citation_handles)) return false;
  if (!links.unmatched_citation_handles.every((handle) => citations.has(handle))) return false;
  const mappedCitations = new Set();
  for (const mapping of links.citation_mappings) {
    if (!mapping || !citations.has(mapping.citation_handle) || mappedCitations.has(mapping.citation_handle)) return false;
    if (!unique(mapping.reference_handles) || !mapping.reference_handles.length || !mapping.reference_handles.every((handle) => references.has(handle))) return false;
    mappedCitations.add(mapping.citation_handle);
  }
  return [...citations].every((handle) => mappedCitations.has(handle) !== links.unmatched_citation_handles.includes(handle));
}

export function applyReferenceLinks(references = [], candidates = {}, links = {}) {
  const mentions = new Map((candidates.citation_mentions || []).map((item) => [item.handle, item]));
  const occurrences = new Map(references.map((item) => [item.link_handle, []]));
  (links.citation_mappings || []).forEach((mapping) => {
    const mention = mentions.get(mapping.citation_handle);
    if (!mention) return;
    mapping.reference_handles.forEach((handle) => occurrences.get(handle)?.push({
      citation_text: mention.citation_text,
      context_quote: mention.context_quote || mention.source?.exact_quote || '',
      source: mention.source
    }));
  });
  return references.map((item) => ({ ...item, body_occurrences: occurrences.get(item.link_handle) || [] }));
}
