const source = {
  type: 'object',
  description: 'Exact raw OCR block in which this bibliography entry begins.',
  additionalProperties: false,
  required: ['ocr_page_id', 'ocr_block_id', 'exact_quote'],
  properties: {
    ocr_page_id: { type: 'string', minLength: 1, description: 'Opaque ID of the original OCR page on which this entry begins.' },
    ocr_block_id: { type: 'string', minLength: 1, description: 'Opaque ID of the supplied raw OCR references block in which this entry begins.' },
    exact_quote: {
      type: 'string',
      minLength: 1,
      maxLength: 180,
      description: 'A short, distinctive, exact verbatim phrase wholly contained in the declared raw OCR block. Stop before that block ends.'
    }
  }
};

const reference = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'text', 'source'],
  properties: {
    id: {
      type: 'string',
      minLength: 1,
      maxLength: 160,
      description: 'A unique model-authored identifier for this bibliography entry.'
    },
    text: {
      type: 'string',
      minLength: 1,
      maxLength: 3000,
      description: 'One complete bibliography entry copied verbatim. Never combine two entries and never return a continuation as a separate entry.'
    },
    source
  }
};

export const referenceAnnotationContractVersion = 'deskreview_reference_annotation_v1';

export function referenceBlocksFromRawPages(rawPages = []) {
  return rawPages.flatMap((page, pageIndex) => (Array.isArray(page?.blocks) ? page.blocks : []).flatMap((block, blockIndex) => (
    String(block?.type || '').toLowerCase() === 'references'
      ? [{
          pageIndex,
          pageId: `ocr-page-${pageIndex}`,
          blockIndex,
          blockId: `ocr-block-${pageIndex}-${blockIndex}`,
          text: String(block?.content || '')
        }]
      : []
  )));
}

export function referenceAnnotationPages(referenceBlocks = []) {
  const pages = [...new Set(referenceBlocks.map((block) => block.pageIndex))].sort((left, right) => left - right);
  if (!pages.length) throw new TypeError('Raw OCR did not return any references blocks.');
  if (pages.length > 8) throw new RangeError('The reference-only annotation candidate is limited to eight original PDF pages.');
  if (!pages.every((page, index) => index === 0 || page === pages[index - 1] + 1)) {
    throw new RangeError('Raw OCR references blocks must occupy one contiguous page range.');
  }
  return pages;
}

export function referenceAnnotationFormat(referenceBlocks = []) {
  const pageIds = [...new Set(referenceBlocks.map((block) => block.pageId))];
  const blockIds = referenceBlocks.map((block) => block.blockId);
  if (!pageIds.length || !blockIds.length) throw new TypeError('Reference annotation requires raw OCR references blocks.');
  const format = {
    type: 'json_schema',
    json_schema: {
      name: referenceAnnotationContractVersion,
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['references'],
        properties: {
          references: {
            type: 'array',
            items: structuredClone(reference),
            description: 'Every individual bibliography entry visible across the supplied raw OCR references blocks, in printed order.'
          }
        }
      }
    }
  };
  const sourceProperties = format.json_schema.schema.properties.references.items.properties.source.properties;
  sourceProperties.ocr_page_id.enum = pageIds;
  sourceProperties.ocr_block_id.enum = blockIds;
  return format;
}

export function referenceAnnotationPrompt(referenceBlocks = []) {
  if (!referenceBlocks.length) throw new TypeError('Reference annotation requires raw OCR references blocks.');
  const blockPacket = referenceBlocks
    .map((block) => `BEGIN ${block.pageId} ${block.blockId}\n${block.text}\nEND ${block.blockId}`)
    .join('\n\n');
  return [
    'This is a bounded bibliography inventory task. Inspect only the bibliography content on the supplied original PDF pages and the authoritative raw OCR references blocks below.',
    'Return every individual bibliography entry exactly once and in printed order. Copy each complete entry verbatim into text. A raw OCR block may contain many entries, and one entry may continue into the next block or page.',
    'Never combine separate entries. Never omit later entries. Never treat a continuation as a new entry. Never summarize, normalize, correct, or complete the OCR from external knowledge.',
    'For source.ocr_page_id and source.ocr_block_id, use the block in which the entry begins. source.exact_quote must be a short distinctive verbatim phrase of at most 180 characters that is wholly contained in that declared starting block. Prefer the author, year, and beginning of the title. Stop the quote before the declared block ends; never continue the source quote into the following block.',
    'Ignore body-text citations and all manuscript content outside these supplied references blocks. Before returning, verify that every entry beginning visible in the complete block packet appears exactly once.',
    'AUTHORITATIVE RAW OCR REFERENCES BLOCKS:',
    blockPacket
  ].join('\n\n');
}

export function referenceAnnotationIssues(result, referenceBlocks = []) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.references)) return ['Missing references array.'];
  const blocks = new Map(referenceBlocks.map((block) => [block.blockId, block]));
  const issues = [];
  result.references.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      issues.push(`Reference ${index + 1} is not an object.`);
      return;
    }
    if (!String(entry.id || '').trim()) issues.push(`Reference ${index + 1} has no id.`);
    if (!String(entry.text || '').trim()) issues.push(`Reference ${index + 1} has no text.`);
    const block = blocks.get(entry.source?.ocr_block_id);
    if (!block) {
      issues.push(`Reference ${index + 1} declares an unknown OCR block.`);
      return;
    }
    if (entry.source?.ocr_page_id !== block.pageId) issues.push(`Reference ${index + 1} declares the wrong OCR page.`);
    const quote = String(entry.source?.exact_quote || '');
    if (!quote || !block.text.includes(quote)) issues.push(`Reference ${index + 1} has an ungrounded exact quote.`);
  });
  return issues;
}
