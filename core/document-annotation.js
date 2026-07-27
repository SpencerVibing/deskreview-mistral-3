const source = {
  type: 'object', additionalProperties: false, required: ['page_number', 'exact_quote'],
  properties: {
    page_number: { type: 'integer', minimum: 1, description: 'The 1-based PDF page that contains exact_quote.' },
    exact_quote: { type: 'string', minLength: 1, description: 'A short, distinctive, verbatim navigation anchor from the stated PDF page. Never markdown and never a summary.' }
  }
};
const textItem = {
  type: 'object', additionalProperties: false, required: ['text', 'source'],
  properties: { text: { type: 'string' }, source }
};
const keywordItem = {
  type: 'object', additionalProperties: false, required: ['text', 'source'],
  properties: { text: { type: 'string', minLength: 1, description: 'Exactly one printed keyword or key phrase. Never combine multiple keywords into one string.' }, source }
};
const schema = (name, properties, required) => ({ type: 'json_schema', json_schema: { name, strict: true, schema: { type: 'object', additionalProperties: false, required, properties } } });
const shared = [
  'Return only information visibly present in the PDF.',
  'Never summarize, paraphrase, infer, repair OCR, or use external knowledge.',
  'Every source object is a navigation anchor. Set page_number to the 1-based PDF page that visibly contains exact_quote. Page numbers start at 1: zero is invalid.',
  'exact_quote must be a short, distinctive, verbatim phrase copied from that one page, usually 5 to 25 words. It may be shorter only for an individual name or a printed table/figure label. Do not use markdown markers. Do not use a whole abstract, section, or bibliography entry as exact_quote.',
  'Before returning each source, verify that its exact_quote visibly occurs on the stated page. If an item lacks a confirmable source, omit that item rather than inventing a source.',
  'Ignore line numbers, running headers, footers, Editorial Manager cover-sheet metadata, and repeated boilerplate unless explicitly requested.',
  'Use empty arrays or zero only when the requested item is genuinely absent.'
].join(' ');

export const annotationPasses = {
  'front-matter': {
    prompt: [shared, 'Extract only the manuscript title and front matter. Return every author as a separate person in printed order; omit affiliation markers and academic degrees from author text. exact_quote must identify the author in the main byline. If the same name is repeated elsewhere, include consecutive neighboring byline text so the anchor is unique; do not anchor to a corresponding-author area. Return every affiliation as an individual item. Return keywords only when an explicit printed Keywords or Key words field occurs in the PDF. Never derive keywords from the title, abstract, or subject matter. Return exactly one array item for each printed keyword or key phrase. Visual line breaks, bullets, commas, semicolons, or other separators in the printed keyword field separate individual keywords; never combine the whole field into one text value. For each returned keyword, use the complete printed keywords field as exact_quote so the anchor identifies the actual keywords list rather than an incidental body-text occurrence. Return the complete verbatim abstract and its exact word_count; exact_quote must be 8 to 20 consecutive opening words of the abstract body after its label, starting with the first sentence rather than an abstract subsection label.'].join(' '),
    format: () => schema('deskreview_front_matter_v1', {
      title: textItem, authors: { type: 'array', items: textItem }, affiliations: { type: 'array', items: textItem }, keywords: { type: 'array', items: keywordItem },
      abstract: { type: 'object', additionalProperties: false, required: ['text', 'word_count', 'source'], properties: { text: { type: 'string' }, word_count: { type: 'integer', minimum: 0 }, source } }
    }, ['title', 'authors', 'affiliations', 'keywords', 'abstract'])
  },
  body: {
    prompt: [shared, 'Extract every manuscript body section in printed order with its printed heading, hierarchy level, complete verbatim text, exact word_count, and source. For each section, use its printed heading and first distinctive body words as the short exact_quote. Do not include title-page, abstract, bibliography, or supplementary sections in this pass. Return every printed table and figure label/caption as a display item. For every display item, use the printed caption label plus a few caption words as exact_quote, not a body-text mention.'].join(' '),
    format: () => schema('deskreview_body_map_v1', {
      sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['heading', 'level', 'text', 'word_count', 'source'], properties: { heading: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 6 }, text: { type: 'string' }, word_count: { type: 'integer', minimum: 0 }, source } } },
      display_items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'label', 'source'], properties: { kind: { type: 'string', enum: ['table', 'figure'] }, label: { type: 'string' }, source } } }
    }, ['sections', 'display_items'])
  },
  references: {
    prompt: [shared, 'Extract every bibliography entry in printed order. Each entry must be one complete verbatim reference with its printed number and source. Keep text as the complete verbatim reference, but use only a short, distinctive phrase from within that bibliography entry as exact_quote. Before returning each entry, locate that exact_quote on the bibliography page and set source.page_number to that specific 1-based PDF page. Never default every reference to page 1. Page 1 is valid only when the source quote visibly occurs there. A source is invalid if its quote does not occur on its stated page.'].join(' '),
    format: () => schema('deskreview_references_v2', { references: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['number', 'text', 'source'], properties: { number: { type: 'integer', minimum: 1 }, text: { type: 'string' }, source } } } }, ['references'])
  }
};
