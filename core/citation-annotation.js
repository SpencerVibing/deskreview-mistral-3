import { MISTRAL_ANNOTATION_MAX_PAGES } from './mistral-annotation-contract.js';
import { validateDeclaredSource } from './source-anchor.js';

// Keep one provider-authored, raw-OCR representation of each occurrence. The
// earlier separate prose anchor encouraged the vision model to normalize PDF
// typography instead of copying the supplied OCR packet.
const citationMention = {
  type: 'object',
  additionalProperties: false,
  required: ['citation_text'],
  properties: {
    citation_text: {
      type: 'string',
      minLength: 1,
      maxLength: 160,
      description: 'The complete bibliographic citation marker or group copied character-for-character from this supplied raw OCR block, such as ¹, [1; 8; 29], (Smith, 2024), or Smith et al. (2024). Preserve OCR punctuation, spacing, markup, and grouping. Never return grant, project, funding, trial registration, DOI, software version, date, dose, measurement, statistical, or numbered-list identifiers.'
    }
  }
};

export const citationAnnotationContractVersion = 'deskreview_body_citations_v10';
export const MAX_CITATION_BLOCKS_PER_REQUEST = 8;
export const MAX_CITATION_REQUESTS_PER_MANUSCRIPT = 12;

export const citationAnnotationPromptInstructions = [
  'This is a bounded body-citation inventory task. The supplied raw OCR article block packet is the sole authoritative transcription source. The matching PDF pages are a visual aid only for deciding whether visible content is a bibliographic citation; never transcribe citation_text from the PDF image.',
  'Return citation_blocks with exactly one result object for every supplied OCR article block, in the same order as the block packet. Copy each supplied ocr_page_id and ocr_block_id exactly. Never omit, duplicate, reorder, or invent a block result.',
  'Inside each block result, return every visible bibliographic citation occurrence whose complete printed citation marker or group physically occurs in that exact block, in reading order. Use an empty citation_mentions array when the block contains none. Never assign an occurrence to the preceding or following block, even when its sentence crosses a block or page boundary.',
  'Return each physical occurrence exactly once, including repeated uses of the same citation in one block. Never duplicate an occurrence, deduplicate separate occurrences, or move one across blocks.',
  'For citation_text, copy the complete citation marker or group character-for-character from between the declared block\'s BEGIN and END markers. Keep a grouped citation together. Preserve the supplied raw OCR punctuation, spacing, superscripts, and markup exactly; never retype, expand, paraphrase, or visually normalize it. The returned citation_text must be a literal substring of its declared raw OCR block.',
  'Exclude headings, front matter, bibliography entries, tables, figures, captions, running headers, footers, standalone years, author-affiliation superscripts, table or figure mentions, grant or project numbers, funding identifiers, clinical-trial registration numbers, software versions, dates, doses, measurements, statistical values, and numbered list items. Before returning, verify every supplied block once and every visible bibliographic citation occurrence within it.'
];

function proseBlockKey(value = '') {
  const match = /^(ocr-block-(\d+)-(\d+))\s+::/.exec(String(value));
  return match ? { blockId: match[1], pageIndex: Number(match[2]), blockIndex: Number(match[3]) } : null;
}

function citationWordTokens(value = '') {
  const tokens = [];
  const matcher = /[\p{L}\p{N}]+/gu;
  for (const match of String(value).matchAll(matcher)) {
    tokens.push({
      value: match[0].normalize('NFKC').toLocaleLowerCase('en'),
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return tokens;
}

/**
 * Finds a presentation anchor without changing the model-authored citation.
 * The search never leaves the declared OCR block and succeeds only once.
 */
export function alignCitationSourceSpan(candidate = '', blockText = '') {
  const returned = String(candidate);
  const source = String(blockText);
  if (!returned || !source) return null;
  if (source.includes(returned)) return { exact_quote: returned, method: 'exact' };

  const candidateTokens = citationWordTokens(returned);
  const sourceTokens = citationWordTokens(source);
  if (!candidateTokens.length || candidateTokens.length > sourceTokens.length) return null;
  const matches = [];
  for (let sourceIndex = 0; sourceIndex <= sourceTokens.length - candidateTokens.length; sourceIndex += 1) {
    const matchesSequence = candidateTokens.every((token, tokenIndex) => (
      token.value === sourceTokens[sourceIndex + tokenIndex].value
    ));
    if (!matchesSequence) continue;
    matches.push({
      start: sourceTokens[sourceIndex].start,
      end: sourceTokens[sourceIndex + candidateTokens.length - 1].end
    });
  }
  if (matches.length !== 1) return null;
  const [match] = matches;
  const candidateTrimmed = returned.trim();
  const matchingDelimiters = { '(': ')', '[': ']', '{': '}' };
  let start = match.start;
  let end = match.end;
  const candidateOpener = candidateTrimmed[0];
  const candidateCloser = matchingDelimiters[candidateOpener];
  if (candidateCloser && candidateTrimmed.at(-1) === candidateCloser) {
    const hasOuterPair = source[start - 1] === candidateOpener && source[end] === candidateCloser;
    const hasNarrativeYearPair = source.slice(start, end).includes(candidateOpener) && source[end] === candidateCloser;
    if (hasOuterPair) {
      start -= 1;
      end += 1;
    } else if (hasNarrativeYearPair) {
      end += 1;
    } else {
      // Do not carve one model-returned member out of a larger source group.
      return null;
    }
  }
  return { exact_quote: source.slice(start, end), method: 'aligned' };
}

/** Projects model-selected article block keys onto the immutable raw OCR blocks. */
export function citationBlocksFromAnnotation(annotationChunks = [], rawPages = []) {
  const selected = new Map();
  annotationChunks.forEach((record) => {
    Object.entries((record.annotation || record).body?.prose_block_types || {}).forEach(([key, type]) => {
      if (type !== 'article') return;
      const identity = proseBlockKey(key);
      const block = identity ? rawPages[identity.pageIndex]?.blocks?.[identity.blockIndex] : null;
      if (!identity || !block || selected.has(identity.blockId)) return;
      selected.set(identity.blockId, {
        pageIndex: identity.pageIndex,
        pageId: `ocr-page-${identity.pageIndex}`,
        blockIndex: identity.blockIndex,
        blockId: identity.blockId,
        text: String(block.content || '')
      });
    });
  });
  return [...selected.values()].sort((left, right) => left.pageIndex - right.pageIndex || left.blockIndex - right.blockIndex);
}

/** Groups selected article blocks into non-overlapping page ranges with bounded block packets. */
export function bodyCitationBlockRanges(annotationChunks = [], rawPages = []) {
  const blocks = citationBlocksFromAnnotation(annotationChunks, rawPages);
  const pageGroups = [];
  blocks.forEach((block) => {
    const current = pageGroups.at(-1);
    if (!current || current.pageIndex !== block.pageIndex) pageGroups.push({ pageIndex: block.pageIndex, blocks: [block] });
    else current.blocks.push(block);
  });
  const ranges = [];
  pageGroups.forEach((pageGroup) => {
    const current = ranges.at(-1);
    const isNextPage = current && pageGroup.pageIndex === current.pages.at(-1) + 1;
    const exceedsPageLimit = current && current.pages.length >= MISTRAL_ANNOTATION_MAX_PAGES;
    const exceedsBlockLimit = current && current.blocks.length + pageGroup.blocks.length > MAX_CITATION_BLOCKS_PER_REQUEST;
    if (!current || !isNextPage || exceedsPageLimit || exceedsBlockLimit) {
      ranges.push({ pages: [pageGroup.pageIndex], blocks: [...pageGroup.blocks] });
      return;
    }
    current.pages.push(pageGroup.pageIndex);
    current.blocks.push(...pageGroup.blocks);
  });
  return ranges;
}

export function citationAnnotationPages(citationBlocks = []) {
  const pages = [...new Set(citationBlocks.map((block) => block.pageIndex))].sort((left, right) => left - right);
  if (!pages.length) throw new TypeError('Body citation annotation requires model-selected OCR article blocks.');
  if (pages.length > MISTRAL_ANNOTATION_MAX_PAGES) throw new RangeError(`Body citation annotation is limited to ${MISTRAL_ANNOTATION_MAX_PAGES} original PDF pages.`);
  if (!pages.every((page, index) => index === 0 || page === pages[index - 1] + 1)) {
    throw new RangeError('Body citation OCR blocks must occupy one contiguous page range.');
  }
  return pages;
}

export function citationAnnotationFormat(citationBlocks = []) {
  const pageIds = [...new Set(citationBlocks.map((block) => block.pageId))];
  const blockIds = citationBlocks.map((block) => block.blockId);
  if (!pageIds.length || !blockIds.length) throw new TypeError('Body citation annotation requires OCR article blocks.');
  return {
    type: 'json_schema',
    json_schema: {
      name: citationAnnotationContractVersion,
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['citation_blocks'],
        properties: {
          citation_blocks: {
            type: 'array',
            minItems: citationBlocks.length,
            maxItems: citationBlocks.length,
            description: 'Exactly one result for every supplied raw OCR article block, in the same order as the block packet.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['ocr_page_id', 'ocr_block_id', 'citation_mentions'],
              properties: {
                ocr_page_id: {
                  type: 'string',
                  enum: pageIds,
                  description: 'Exact opaque OCR page ID copied from the supplied block header.'
                },
                ocr_block_id: {
                  type: 'string',
                  enum: blockIds,
                  description: 'Exact opaque OCR block ID copied from the supplied block header.'
                },
                citation_mentions: {
                  type: 'array',
                  items: structuredClone(citationMention),
                  description: 'Every visible bibliographic citation occurrence in this article block, in reading order. Empty when this block contains none.'
                }
              }
            }
          }
        }
      }
    }
  };
}

export function citationAnnotationPrompt(citationBlocks = []) {
  if (!citationBlocks.length) throw new TypeError('Body citation annotation requires OCR article blocks.');
  const blockPacket = citationBlocks
    .map((block) => `BEGIN ${block.pageId} ${block.blockId}\n${block.text}\nEND ${block.blockId}`)
    .join('\n\n');
  return [
    ...citationAnnotationPromptInstructions,
    'AUTHORITATIVE RAW OCR ARTICLE BLOCKS:',
    blockPacket
  ].join('\n\n');
}

export function citationAnnotationIssues(result, citationBlocks = []) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.citation_blocks)) return ['Missing citation_blocks array.'];
  const blocks = new Map(citationBlocks.map((block) => [block.blockId, block]));
  const expectedBlockIds = citationBlocks.map((block) => block.blockId);
  const returnedBlockIds = new Set();
  const issues = [];
  let citationIndex = 0;
  if (result.citation_blocks.length !== citationBlocks.length) {
    issues.push(`Expected ${citationBlocks.length} citation block results but received ${result.citation_blocks.length}.`);
  }
  result.citation_blocks.forEach((blockResult, blockResultIndex) => {
    if (!blockResult || typeof blockResult !== 'object') {
      issues.push(`Citation block result ${blockResultIndex + 1} is not an object.`);
      return;
    }
    const blockId = String(blockResult.ocr_block_id || '');
    const block = blocks.get(blockId);
    if (!block) {
      issues.push(`Citation block result ${blockResultIndex + 1} declares an unknown OCR block.`);
      return;
    }
    if (returnedBlockIds.has(blockId)) issues.push(`Citation block ${blockId} was returned more than once.`);
    returnedBlockIds.add(blockId);
    if (blockId !== expectedBlockIds[blockResultIndex]) issues.push(`Citation block result ${blockResultIndex + 1} is not in supplied block order.`);
    if (blockResult.ocr_page_id !== block.pageId) issues.push(`Citation block ${blockId} declares the wrong OCR page.`);
    if (!Array.isArray(blockResult.citation_mentions)) {
      issues.push(`Citation block ${blockId} has no citation_mentions array.`);
      return;
    }
    blockResult.citation_mentions.forEach((mention) => {
      citationIndex += 1;
      if (!mention || typeof mention !== 'object') {
        issues.push(`Citation ${citationIndex} is not an object.`);
        return;
      }
      const citationText = String(mention.citation_text || '');
      if (!citationText.trim()) issues.push(`Citation ${citationIndex} has no citation text.`);
      if (citationText && !alignCitationSourceSpan(citationText, block.text)) issues.push(`Citation ${citationIndex} has citation text that is not present or uniquely alignable in its declared OCR block.`);
    });
    const sourceOccurrenceCounts = new Map();
    const returnedOccurrenceCounts = new Map();
    blockResult.citation_mentions.forEach((mention, mentionIndex) => {
      const citationText = String(mention?.citation_text || '');
      const alignment = alignCitationSourceSpan(citationText, block.text);
      if (!alignment) return;
      const sourceQuote = alignment.exact_quote;
      if (!sourceOccurrenceCounts.has(sourceQuote)) {
        let count = 0;
        let offset = 0;
        while ((offset = block.text.indexOf(sourceQuote, offset)) !== -1) {
          count += 1;
          offset += sourceQuote.length;
        }
        sourceOccurrenceCounts.set(sourceQuote, count);
      }
      const returnedCount = (returnedOccurrenceCounts.get(sourceQuote) || 0) + 1;
      returnedOccurrenceCounts.set(sourceQuote, returnedCount);
      if (returnedCount > sourceOccurrenceCounts.get(sourceQuote)) {
        const priorMentions = result.citation_blocks
          .slice(0, blockResultIndex)
          .reduce((total, prior) => total + (Array.isArray(prior?.citation_mentions) ? prior.citation_mentions.length : 0), 0);
        issues.push(`Citation ${priorMentions + mentionIndex + 1} is returned more often than its exact text occurs in the declared OCR block.`);
      }
    });
  });
  expectedBlockIds.forEach((blockId) => {
    if (!returnedBlockIds.has(blockId)) issues.push(`Citation block ${blockId} is missing from the response.`);
  });
  return issues;
}

/**
 * Projects a validated provider response into the established relation shape.
 * The declared raw block is retained as complete display context. The exact
 * citation marker remains the sole navigation anchor; no context is inferred.
 */
export function citationAnnotationMentions(result = {}, citationBlocks = []) {
  if (!Array.isArray(result.citation_blocks)) return [];
  const blocks = new Map(citationBlocks.map((block) => [block.blockId, block]));
  return result.citation_blocks.flatMap((blockResult) => (
    Array.isArray(blockResult?.citation_mentions)
      ? blockResult.citation_mentions.map(({ citation_text: citationText }) => {
          const blockText = String(blocks.get(blockResult.ocr_block_id)?.text || '');
          const alignment = alignCitationSourceSpan(citationText, blockText);
          return {
            label: citationText,
            context_quote: blockText || citationText,
            source_alignment: alignment?.method || 'unavailable',
            source: {
              ocr_page_id: blockResult.ocr_page_id,
              ocr_block_id: blockResult.ocr_block_id,
              exact_quote: alignment?.exact_quote || citationText
            }
          };
        })
      : []
  ));
}

export function validCitationAnnotation(value, citationBlocks = []) {
  return citationAnnotationIssues(value, citationBlocks).length === 0;
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
    const citations = record.citation_mentions || [];
    const returnedSourceCounts = new Map();
    const items = citations.map((item, itemIndex) => {
      const reasons = [];
      // Passive validation only: reject a false location, but never relocate or
      // rewrite an anchor when a model response names the wrong OCR block.
      const declared = validateDeclaredSource(rawPages, { source: item.source });
      if (!declared) reasons.push('context_not_in_declared_ocr_block');
      const blockMatch = /^ocr-block-(\d+)-(\d+)$/.exec(String(item.source?.ocr_block_id || ''));
      const exactQuote = String(item.source?.exact_quote || '');
      if (blockMatch && exactQuote) {
        const blockText = String(rawPages[Number(blockMatch[1])]?.blocks?.[Number(blockMatch[2])]?.content || '');
        const sourceKey = `${item.source.ocr_block_id}\u001f${exactQuote}`;
        const returnedCount = (returnedSourceCounts.get(sourceKey) || 0) + 1;
        returnedSourceCounts.set(sourceKey, returnedCount);
        let sourceCount = 0;
        let offset = 0;
        while ((offset = blockText.indexOf(exactQuote, offset)) !== -1) {
          sourceCount += 1;
          offset += exactQuote.length;
        }
        if (returnedCount > sourceCount) reasons.push('citation_occurrence_exceeds_source');
      }
      const accepted = reasons.length === 0;
      const source = accepted ? {
        ocr_page_id: item.source.ocr_page_id,
        ocr_block_id: item.source.ocr_block_id,
        exact_quote: item.source.exact_quote
      } : null;
      return {
        index: itemIndex,
        label: item.label,
        anchorText: item.context_quote,
        sourceAlignment: item.source_alignment || 'unavailable',
        accepted,
        reasons,
        source,
        pageId: source?.ocr_page_id || item.source?.ocr_page_id || '',
        blockId: source?.ocr_block_id || item.source?.ocr_block_id || '',
        ...(accepted ? {
          candidate: {
            handle: `citation-mention:r${rangeIndex}:i${itemIndex}:q${stableHash(`${item.context_quote}\u001f${item.label}`)}`,
            citation_text: item.label,
            context_quote: item.context_quote,
            source_alignment: item.source_alignment || 'exact',
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
      blockResults: Array.isArray(record.citation_blocks) ? record.citation_blocks : null,
      suppliedBlocks: Array.isArray(record.supplied_blocks) ? record.supplied_blocks : [],
      issues: Array.isArray(record.issues) ? record.issues : [],
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
