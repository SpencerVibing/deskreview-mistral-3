const reference = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'printed_label', 'text'],
  properties: {
    id: {
      type: 'string',
      minLength: 1,
      maxLength: 160,
      description: 'A unique model-authored identifier for this bibliography entry.'
    },
    printed_label: {
      type: 'string',
      maxLength: 40,
      description: 'The exact visible numbering label printed before this bibliography entry, such as 1, 1., [1], or (1). Return an empty string when the bibliography is unnumbered.'
    },
    text: {
      type: 'string',
      minLength: 1,
      maxLength: 3000,
      description: 'The complete text of one bibliography entry, copied exactly as shown. Keep separate references as separate items.'
    }
  }
};

export const referenceAnnotationContractVersion = 'deskreview_reference_annotation_v7';
export const MIN_REFERENCE_TEXT_COVERAGE = 0.9;
export const referenceAnnotationPromptInstructions = [
  'This is a bounded bibliography inventory task. Inspect only the bibliography content on the supplied original PDF pages and the authoritative raw OCR references blocks below.',
  'Return one flat references array in printed order across the complete supplied block packet. Copy every complete bibliography entry verbatim into text. Return its exact visible numbering prefix in printed_label, excluding that prefix from text only when it is clearly separate; use an empty printed_label for unnumbered bibliographies. A raw OCR block may contain many entries, and one entry may continue into the next block or page.',
  'Never combine separate entries. Never omit later entries. Never treat a continuation as a new entry. Never summarize, normalize, correct, or complete the OCR from external knowledge.',
  'Each returned reference becomes one independent DeskReview HTML reference item. Return only its unique id, printed_label, and complete verbatim text; do not return an OCR page ID, OCR block ID, second anchor, excerpt, summary, or metadata parse.',
  'Ignore body-text citations and all manuscript content outside these supplied references blocks. Before returning, verify that every entry beginning visible in the complete block packet appears exactly once.'
];

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
  if (!referenceBlocks.length) throw new TypeError('Reference annotation requires raw OCR references blocks.');
  return {
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
            description: 'Every complete bibliography entry across the supplied raw OCR block packet, in printed order.'
          }
        }
      }
    }
  };
}

export function referenceAnnotationPrompt(referenceBlocks = []) {
  if (!referenceBlocks.length) throw new TypeError('Reference annotation requires raw OCR references blocks.');
  const blockPacket = referenceBlocks
    .map((block) => `BEGIN ${block.pageId} ${block.blockId}\n${block.text}\nEND ${block.blockId}`)
    .join('\n\n');
  return [
    ...referenceAnnotationPromptInstructions,
    'AUTHORITATIVE RAW OCR REFERENCES BLOCKS:',
    blockPacket
  ].join('\n\n');
}

export function referenceAnnotationIssues(result, referenceBlocks = []) {
  return referenceAnnotationAcceptanceIssues(result, referenceBlocks);
}

/**
 * Blocking checks for the flat bibliography product object. Raw OCR block
 * associations are input-only and are never requested from the model.
 */
export function referenceAnnotationAcceptanceIssues(result, referenceBlocks = []) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.references)) return ['Missing references array.'];
  const issues = [];
  const returnedReferenceIds = new Set();
  result.references.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      issues.push(`Reference ${index + 1} is not an object.`);
      return;
    }
    const id = String(entry.id || '').trim();
    if (!id) issues.push(`Reference ${index + 1} has no id.`);
    if (id && returnedReferenceIds.has(id)) issues.push(`Reference ${index + 1} repeats identifier ${id}.`);
    if (id) returnedReferenceIds.add(id);
    if (typeof entry.printed_label !== 'string') issues.push(`Reference ${index + 1} has no printed_label string.`);
    if (!String(entry.text || '').trim()) issues.push(`Reference ${index + 1} has no text.`);
  });
  const coverage = referenceAnnotationCoverage(result, referenceBlocks);
  if (coverage.sourceCharacters && coverage.ratio < MIN_REFERENCE_TEXT_COVERAGE) {
    issues.push(`Returned reference text covers only ${coverage.percent}% of the supplied OCR bibliography blocks.`);
  }
  return issues;
}

/**
 * Semantics-free completeness signal for a verbatim extraction contract.
 * It counts non-whitespace characters only; it never splits, repairs, or infers
 * references. Grossly incomplete output must fail closed instead of becoming a
 * plausible but incorrect reference count.
 */
export function referenceAnnotationCoverage(result = {}, referenceBlocks = []) {
  const compactLength = (value = '') => String(value).replace(/\s+/g, '').length;
  const sourceCharacters = referenceBlocks.reduce((total, block) => total + compactLength(block?.text), 0);
  const returnedCharacters = Array.isArray(result?.references)
    ? result.references.reduce((total, entry) => total + compactLength(entry?.printed_label) + compactLength(entry?.text), 0)
    : 0;
  const ratio = sourceCharacters ? returnedCharacters / sourceCharacters : 0;
  return {
    sourceCharacters,
    returnedCharacters,
    ratio,
    percent: Number((ratio * 100).toFixed(1))
  };
}

/** Projects each model-separated bibliography item into one stable HTML reference object. */
export function referenceAnnotationReferences(result = {}) {
  return Array.isArray(result.references) ? result.references.map((entry) => ({ ...entry })) : [];
}
