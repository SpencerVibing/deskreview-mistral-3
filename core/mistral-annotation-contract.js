export const MISTRAL_ANNOTATION_MAX_PAGES = 8;

const forbiddenSchemaFields = new Set(['full_document', 'full_text', 'markdown', 'html', 'table_html', 'bibliography_text']);

function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

/** Returns explicit sequential OCR page ranges of at most eight zero-based indexes. */
export function annotationPageRanges(pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new TypeError('Annotation requires a positive OCR page count.');
  return Array.from({ length: Math.ceil(pageCount / MISTRAL_ANNOTATION_MAX_PAGES) }, (_, index) => {
    const start = index * MISTRAL_ANNOTATION_MAX_PAGES;
    return Array.from({ length: Math.min(MISTRAL_ANNOTATION_MAX_PAGES, pageCount - start) }, (_, offset) => start + offset);
  });
}

/** Rejects unbounded, non-sequential, or non-zero-based annotation page requests. */
export function assertAnnotationPageRange(pages) {
  if (!Array.isArray(pages) || !pages.length || pages.length > MISTRAL_ANNOTATION_MAX_PAGES) throw new RangeError(`Document annotations require 1-${MISTRAL_ANNOTATION_MAX_PAGES} explicit OCR pages.`);
  if (!pages.every((page, index) => Number.isInteger(page) && page >= 0 && (index === 0 || page === pages[index - 1] + 1))) throw new TypeError('Document annotation pages must be sequential zero-based OCR indexes.');
  return pages;
}

function walkSchema(schema, visit) {
  if (!object(schema)) return;
  visit(schema);
  Object.values(schema.properties || {}).forEach((value) => walkSchema(value, visit));
  walkSchema(schema.items, visit);
  (schema.anyOf || []).forEach((value) => walkSchema(value, visit));
}

function findSourceSchema(schema) {
  if (!object(schema)) return null;
  if (object(schema.properties?.source)) return schema.properties.source;
  for (const value of Object.values(schema.properties || {})) {
    const found = findSourceSchema(value) || findSourceSchema(value?.items);
    if (found) return found;
  }
  return null;
}

function hasFlatReferenceInventory(schema) {
  const referenceItems = schema?.properties?.references?.items;
  if (!object(referenceItems)) return false;
  const referenceRequired = new Set(referenceItems.required || []);
  return Boolean(
    referenceItems.properties?.id
    && referenceItems.properties?.text
    && referenceRequired.has('id')
    && referenceRequired.has('text')
  );
}

/** Ensures an annotation format is compact enough for Mistral's eight-page stage. */
export function assertCompactAnnotationFormat(format) {
  const schema = format?.json_schema?.schema;
  if (!object(schema)) throw new TypeError('A JSON Schema document annotation format is required.');
  const violations = [];
  walkSchema(schema, (node) => {
    Object.keys(node.properties || {}).forEach((name) => {
      if (forbiddenSchemaFields.has(name)) violations.push(name);
    });
  });
  if (violations.length) throw new TypeError(`Annotation schema duplicates raw OCR fields: ${[...new Set(violations)].join(', ')}.`);
  if (hasFlatReferenceInventory(schema)) return format;
  const source = findSourceSchema(schema);
  if (!source?.properties?.exact_quote) throw new TypeError('Annotation schema sources require an exact_quote.');
  if (!source.properties.ocr_page_id || !source.properties.ocr_block_id) throw new TypeError('Annotation schema sources require OCR page and block identifiers.');
  const required = new Set(source.required || []);
  if (!required.has('ocr_page_id') || !required.has('ocr_block_id') || !required.has('exact_quote')) throw new TypeError('Annotation schema sources must require OCR page, block, and quote fields.');
  return format;
}
