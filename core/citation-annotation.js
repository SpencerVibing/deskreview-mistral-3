import { MISTRAL_ANNOTATION_MAX_PAGES } from './mistral-annotation-contract.js';
import { validateDeclaredSource } from './source-anchor.js';

export const citationAnnotationContractVersion = 'deskreview_body_citations_v1';

export const citationAnnotationFormat = {
  type: 'json_schema',
  json_schema: {
    name: citationAnnotationContractVersion,
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['citation_mentions'],
      properties: {
        citation_mentions: {
          type: 'array',
          description: 'Every visible bibliographic citation group in narrative article prose on the supplied pages, in reading order.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'context_quote'],
            properties: {
              label: {
                type: 'string',
                minLength: 1,
                maxLength: 900,
                description: 'Exact complete printed bibliographic citation group, including grouped author-year, numeric, range, superscript, or narrative forms.'
              },
              context_quote: {
                type: 'string',
                minLength: 1,
                maxLength: 1200,
                description: 'Exact visible sentence or short phrase containing label, copied verbatim from the supplied document.'
              }
            }
          }
        }
      }
    }
  }
};

export const citationAnnotationPromptInstructions = [
  'Extract every visible bibliographic citation occurrence from narrative article prose on the supplied pages.',
  'Preserve each complete printed citation group verbatim, including grouped author-year citations, numeric lists or ranges, superscript citations, and narrative author-year citations.',
  'Exclude headings, front matter, bibliography entries, tables, figures, captions, running headers, footers, standalone years, and table or figure mentions.',
  'context_quote must be an exact visible sentence or short phrase containing label.',
  'Return an empty array only when no bibliographic citation is visible in narrative article prose.'
];

export const citationAnnotationPrompt = citationAnnotationPromptInstructions.join(' ');

export function validCitationAnnotation(value) {
  return Boolean(value)
    && typeof value === 'object'
    && Array.isArray(value.citation_mentions)
    && value.citation_mentions.every((item) => (
      item
      && typeof item === 'object'
      && typeof item.label === 'string'
      && item.label.trim()
      && item.label.length <= 900
      && typeof item.context_quote === 'string'
      && item.context_quote.trim()
      && item.context_quote.length <= 1200
    ));
}

function pageIndexFromProseKey(value = '') {
  const match = /^ocr-block-(\d+)-\d+\s+::/.exec(String(value));
  return match ? Number(match[1]) : null;
}

export function bodyCitationPageRanges(annotationChunks = []) {
  const pages = [...new Set(annotationChunks.flatMap((record) => (
    Object.entries((record.annotation || record).body?.prose_block_types || {})
      .filter(([, type]) => type === 'article')
      .map(([key]) => pageIndexFromProseKey(key))
      .filter(Number.isInteger)
  )))].sort((first, second) => first - second);
  const ranges = [];
  pages.forEach((page) => {
    const current = ranges.at(-1);
    if (!current || current.length >= MISTRAL_ANNOTATION_MAX_PAGES || page !== current.at(-1) + 1) ranges.push([page]);
    else current.push(page);
  });
  return ranges;
}

function stableHash(value = '') {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function bindCitationAnnotationRanges(records = [], rawPages = []) {
  const ranges = records.map((record, rangeIndex) => {
    const citations = record.annotation?.citation_mentions || record.citation_mentions || [];
    const items = citations.map((item, itemIndex) => {
      const reasons = [];
      if (!String(item.context_quote || '').includes(String(item.label || ''))) reasons.push('label_not_in_context');
      const declared = validateDeclaredSource(rawPages, { source: { exact_quote: item.context_quote } });
      if (!declared) reasons.push('context_not_unique_in_raw_ocr');
      const accepted = reasons.length === 0;
      const source = accepted ? {
        ocr_page_id: `ocr-page-${declared.pageNumber - 1}`,
        ...(Number.isInteger(declared.blockIndex) ? { ocr_block_id: `ocr-block-${declared.pageNumber - 1}-${declared.blockIndex}` } : {}),
        exact_quote: item.context_quote
      } : null;
      return {
        index: itemIndex,
        label: item.label,
        contextQuote: item.context_quote,
        accepted,
        reasons,
        source,
        pageId: source?.ocr_page_id || '',
        blockId: source?.ocr_block_id || '',
        ...(accepted ? {
          candidate: {
            handle: `citation-mention:r${rangeIndex}:i${itemIndex}:q${stableHash(`${item.context_quote}\u001f${item.label}`)}`,
            citation_text: item.label,
            context_quote: item.context_quote,
            source
          }
        } : {})
      };
    });
    const reasonCounts = items.flatMap((item) => item.reasons).reduce((counts, reason) => ({
      ...counts,
      [reason]: (counts[reason] || 0) + 1
    }), {});
    return {
      id: record.range_id || `citation-range-${rangeIndex}`,
      pages: Array.isArray(record.pages) ? [...record.pages] : [],
      returned: items.length,
      accepted: items.filter((item) => item.accepted).length,
      rejected: items.filter((item) => !item.accepted).length,
      reasonCounts,
      items
    };
  });
  return {
    ranges,
    candidates: ranges.flatMap((range) => range.items.flatMap((item) => item.candidate ? [item.candidate] : []))
  };
}
