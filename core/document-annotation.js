const source = {
  type: 'object', additionalProperties: false, required: ['page_number', 'exact_quote'],
  properties: {
    page_number: { type: 'integer', minimum: 1, description: 'The 1-based PDF page containing exact_quote.' },
    exact_quote: { type: 'string', minLength: 1, description: 'A short, distinctive verbatim phrase copied from that exact page. Never markdown or a summary.' }
  }
};

const textItem = { type: 'object', additionalProperties: false, required: ['text', 'source'], properties: { text: { type: 'string' }, source } };
const keywordItem = { type: 'object', additionalProperties: false, required: ['text', 'source'], properties: { text: { type: 'string', minLength: 1, description: 'Exactly one printed keyword or key phrase.' }, source } };
const abstract = { type: 'object', additionalProperties: false, required: ['text', 'word_count', 'source'], properties: { text: { type: 'string' }, word_count: { type: 'integer', minimum: 0 }, source } };
const section = { type: 'object', additionalProperties: false, required: ['heading', 'level', 'text', 'word_count', 'source'], properties: { heading: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 6 }, text: { type: 'string' }, word_count: { type: 'integer', minimum: 0 }, source } };
const displayItem = { type: 'object', additionalProperties: false, required: ['kind', 'label', 'source'], properties: { kind: { type: 'string', enum: ['table', 'figure'] }, label: { type: 'string' }, source } };
const reference = { type: 'object', additionalProperties: false, required: ['number', 'text', 'source'], properties: { number: { type: 'integer', minimum: 1 }, text: { type: 'string' }, source } };

export const documentAnnotationFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'deskreview_document_map_v1', strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['front_matter', 'body', 'references'],
      properties: {
        front_matter: { type: 'object', additionalProperties: false, required: ['title', 'authors', 'affiliations', 'keywords', 'abstract'], properties: { title: textItem, authors: { type: 'array', items: textItem }, affiliations: { type: 'array', items: textItem }, keywords: { type: 'array', items: keywordItem }, abstract } },
        body: { type: 'object', additionalProperties: false, required: ['sections', 'display_items'], properties: { sections: { type: 'array', items: section }, display_items: { type: 'array', items: displayItem } } },
        references: { type: 'object', additionalProperties: false, required: ['references'], properties: { references: { type: 'array', items: reference } } }
      }
    }
  }
};

export const documentAnnotationPrompt = [
  'Return only information visibly present in the PDF. Never summarize, paraphrase, infer, repair OCR, or use external knowledge.',
  'Every source object is a navigation anchor. Set page_number to the 1-based PDF page that visibly contains exact_quote. exact_quote must be a short distinctive verbatim phrase on that same page, normally 5 to 25 words. Verify this before returning every item. If an item lacks a confirmable source, omit it rather than inventing a source.',
  'Ignore line numbers, running headers, footers, Editorial Manager cover-sheet metadata, and repeated boilerplate unless explicitly requested. Preserve complete verbatim section and bibliography text where the schema asks for text.',
  'Extract title and front matter from the manuscript byline, not cover-sheet metadata. Return every author separately in printed order, without degrees or affiliation markers. Return every affiliation separately. Return keywords only from an explicit printed Keywords or Key words field, one array item per printed phrase. For each keyword source, use the complete printed keywords field as exact_quote. Return the complete verbatim abstract and its exact word count.',
  'Extract every body section in printed order, its printed heading, hierarchy level, complete verbatim text, exact word count, and a source quote from its heading and opening body text. Exclude title page, abstract, bibliography, and supplementary sections. Return every printed table and figure caption as a display item using caption text, never a body-text mention, as its source quote.',
  'Extract every bibliography entry in printed order. Keep each entry complete and verbatim. Its source quote must be a distinctive phrase from that exact entry on its actual bibliography page; never assign a reference to another page or default all references to page 1.'
].join(' ');
