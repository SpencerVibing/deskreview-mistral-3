function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function source(value) { return object(value) && Number.isInteger(value.page_number) && value.page_number > 0 && typeof value.exact_quote === 'string' && value.exact_quote.trim().length > 0; }
function textItem(value) { return object(value) && typeof value.text === 'string' && source(value.source); }

/** Passive validation only. Invalid model data is rejected; it is never repaired. */
export function hasValidDocumentAnnotation(annotation) {
  if (!object(annotation) || !object(annotation.front_matter) || !object(annotation.body) || !object(annotation.references)) return false;
  const front = annotation.front_matter;
  const body = annotation.body;
  const bibliography = annotation.references;
  if (!textItem(front.title) || !Array.isArray(front.authors) || !front.authors.every(textItem) || !Array.isArray(front.affiliations) || !front.affiliations.every(textItem) || !Array.isArray(front.keywords) || !front.keywords.every(textItem)) return false;
  if (!object(front.abstract) || typeof front.abstract.text !== 'string' || !Number.isInteger(front.abstract.word_count) || front.abstract.word_count < 0 || !source(front.abstract.source)) return false;
  if (!Array.isArray(body.sections) || !body.sections.every((item) => object(item) && typeof item.heading === 'string' && Number.isInteger(item.level) && item.level >= 1 && item.level <= 6 && typeof item.text === 'string' && Number.isInteger(item.word_count) && item.word_count >= 0 && source(item.source))) return false;
  if (!Array.isArray(body.display_items) || !body.display_items.every((item) => object(item) && ['table', 'figure'].includes(item.kind) && typeof item.label === 'string' && source(item.source))) return false;
  return Array.isArray(bibliography.references) && bibliography.references.every((item) => object(item) && Number.isInteger(item.number) && item.number >= 1 && typeof item.text === 'string' && source(item.source));
}
