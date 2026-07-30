function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function source(value) {
  return object(value)
    && /^ocr-page-\d+$/.test(String(value.ocr_page_id || ''))
    && /^ocr-block-\d+-\d+$/.test(String(value.ocr_block_id || ''))
    && typeof value.exact_quote === 'string'
    && value.exact_quote.trim().length > 0
    && value.exact_quote.length <= 1200;
}
function array(value, validate) { return Array.isArray(value) && value.every(validate); }
function id(value) { return typeof value === 'string' && value.trim().length > 0; }
function sourceItem(value) { return object(value) && id(value.id) && id(value.label) && id(value.item_exact_quote) && source(value.source); }
function author(value) { return object(value) && id(value.id) && id(value.label) && typeof value.orcid === 'string' && source(value.source); }
function link(value) { return object(value) && id(value.author_id) && id(value.affiliation_id); }
function abstract(value) { return object(value) && source(value.source); }
function proseBlockTypes(value) { return object(value) && Object.entries(value).every(([key, type]) => /^ocr-block-\d+-\d+ :: .+/.test(key) && ['abstract', 'article', 'excluded'].includes(type)); }
function section(value) { return object(value) && id(value.id) && id(value.heading) && Number.isInteger(value.level) && value.level >= 1 && value.level <= 6 && source(value.source); }
function display(value) { return object(value) && id(value.id) && ['table', 'figure'].includes(value.kind) && id(value.label) && source(value.source); }
function mention(value) { return sourceItem(value); }
/** Passive validation only. Invalid model data is rejected; it is never repaired. */
export function documentAnnotationIssues(annotation) {
  if (!object(annotation) || !object(annotation.front_matter) || !object(annotation.body) || !object(annotation.displays)) return ['Missing a required top-level result group.'];
  const front = annotation.front_matter;
  const body = annotation.body;
  const displays = annotation.displays;
  const issues = [];
  const check = (valid, label) => { if (!valid) issues.push(label); };
  check(array(front.titles, sourceItem), 'front_matter.titles contains an invalid item.');
  check(array(front.authors, author), 'front_matter.authors contains an invalid item.');
  check(array(front.affiliations, sourceItem), 'front_matter.affiliations contains an invalid item.');
  check(array(front.author_affiliation_links, link), 'front_matter.author_affiliation_links contains an invalid item.');
  check(array(front.keywords, sourceItem), 'front_matter.keywords contains an invalid item.');
  check(array(front.abstracts, abstract), 'front_matter.abstracts contains an invalid item.');
  check(array(body.sections, section), 'body.sections contains an invalid item.');
  check(array(body.display_mentions, mention), 'body.display_mentions contains an invalid item.');
  check(proseBlockTypes(body.prose_block_types), 'body.prose_block_types contains an invalid item.');
  check(array(displays.entries, display), 'displays.entries contains an invalid item.');
  return issues;
}

export function hasValidDocumentAnnotation(annotation) {
  return documentAnnotationIssues(annotation).length === 0;
}
