const source = {
  type: 'object',
  description: 'Exact raw OCR location used to verify and navigate to this returned manuscript item.',
  additionalProperties: false,
  required: ['ocr_page_id', 'ocr_block_id', 'exact_quote'],
  properties: {
    ocr_page_id: { type: 'string', minLength: 1, description: 'Opaque raw OCR page identifier from the supplied source-block map, such as ocr-page-0.' },
    ocr_block_id: { type: 'string', minLength: 1, description: 'Opaque raw OCR block identifier from the supplied source-block map, such as ocr-block-0-3.' },
    exact_quote: { type: 'string', minLength: 1, maxLength: 1200, description: 'A short, exact, globally unique verbatim OCR phrase that grounds this item. Never markdown, HTML, a summary, or an inferred phrase.' }
  }
};
const sourceItem = {
  type: 'object', description: 'One visible manuscript item with its exact text and source location.', additionalProperties: false, required: ['id', 'label', 'item_exact_quote', 'source'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 160, description: 'Stable model-authored document key.' },
    label: { type: 'string', minLength: 1, maxLength: 400, description: 'Exact visible item text, with visual line breaks collapsed only.' },
    item_exact_quote: { type: 'string', minLength: 1, maxLength: 400, description: 'The exact visible item text inside source.exact_quote. For a keyword, this is the individual keyword, not the whole list.' },
    source
  }
};
const author = {
  type: 'object', description: 'Exactly one visible human byline author. Never combine multiple people or return contribution initials, correspondence text, or an et al. abbreviation as an author.', additionalProperties: false, required: ['id', 'label', 'orcid', 'source'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 160, description: 'Stable model-authored key for this individual author.' },
    label: { type: 'string', minLength: 1, maxLength: 240, description: 'One author name copied verbatim, without affiliation markers or credentials unless visibly part of the person name.' },
    orcid: { type: 'string', maxLength: 80, description: 'Visible ORCID for this author, or an empty string when none is printed.' },
    source
  }
};
const link = {
  type: 'object', description: 'One visibly supported author-to-affiliation relationship based on printed superscripts or unambiguous layout.', additionalProperties: false, required: ['author_id', 'affiliation_id'],
  properties: {
    author_id: { type: 'string', minLength: 1, maxLength: 160, description: 'ID of an author returned in this same annotation response.' },
    affiliation_id: { type: 'string', minLength: 1, maxLength: 160, description: 'ID of a complete affiliation returned in this same annotation response.' }
  }
};
const abstract = {
  type: 'object', description: 'The single visible opening research abstract or equivalent Summary, including an unlabeled abstract when its front-matter placement and structure make that role clear.', additionalProperties: false, required: ['source'],
  properties: {
    source
  }
};
const section = {
  type: 'object', description: 'One actual printed article section heading. Never return captions, display titles, bibliography entries, body sentences, line numbers, or running headers.', additionalProperties: false, required: ['id', 'heading', 'level', 'source'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 160, description: 'Stable model-authored key for this printed section heading.' },
    heading: { type: 'string', minLength: 1, maxLength: 320, description: 'Exact visible manuscript section heading only. Never a table caption, figure caption, display title, bibliography heading continuation, body sentence, line number, or running header.' },
    level: { type: 'integer', minimum: 1, maximum: 6, description: 'Visible heading hierarchy level, where 1 is a top-level manuscript section.' },
    source
  }
};
const display = {
  type: 'object', description: 'One actual captioned table or figure, grounded at its caption rather than at a body-text mention.', additionalProperties: false, required: ['id', 'kind', 'label', 'source'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 160, description: 'Stable model-authored key for this table or figure.' },
    kind: { type: 'string', enum: ['table', 'figure'], description: 'Whether this caption identifies a table or a figure.' },
    label: { type: 'string', minLength: 1, maxLength: 400, description: 'Exact visible table or figure caption.' },
    source
  }
};
const bodyMention = {
  type: 'object', description: 'One complete exact narrative-prose mention of a table or figure, such as Table 2, Fig. 1, Fig. S1, Table S2, Fig. 3A, or Tables 1 and 2. Keep a grouped printed mention as one item. Exclude bibliography entries, captions, table cells, figure labels, bibliographic citations, and running material. label and item_exact_quote must be identical and contain only the visible marker; source.exact_quote must be a unique verbatim sentence or short surrounding phrase containing it.', additionalProperties: false, required: ['id', 'label', 'item_exact_quote', 'source'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 160, description: 'Stable model-authored key for this exact body-text mention.' },
    label: { type: 'string', minLength: 1, maxLength: 180, description: 'Complete exact printed citation group or display mention.' },
    item_exact_quote: { type: 'string', minLength: 1, maxLength: 180, description: 'Exact visible marker inside source.exact_quote; equal to label.' },
    source
  }
};
/**
 * Compact source-grounded schema. Raw OCR remains the only owner of manuscript
 * text; annotations select exact OCR blocks and provide the semantic inventory.
 */
export const documentAnnotationContractVersion = 'deskreview_document_annotation_v16';

export const documentAnnotationFormat = {
  type: 'json_schema',
  json_schema: {
    name: documentAnnotationContractVersion,
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['front_matter', 'body', 'displays'],
      properties: {
        front_matter: {
          type: 'object',
          description: 'Visible manuscript front matter only: title, byline authors, complete affiliations, explicit author-affiliation links, labelled keywords, and one abstract or equivalent opening Summary.',
          additionalProperties: false,
          required: ['titles', 'authors', 'affiliations', 'author_affiliation_links', 'keywords', 'abstracts'],
          properties: {
            titles: { type: 'array', description: 'Every visible manuscript title, in printed order. Use the exact title text and never substitute a running header. item_exact_quote must be the exact individual title label.', items: sourceItem },
            authors: { type: 'array', description: 'Every visible human byline author as one separate item, in manuscript order. Split every multi-name byline into individual people and use the full visible byline rather than a compressed et al. form. Never return a whole author line as one item; names from contribution, conflict, acknowledgement, disclosure, or correspondence text; contribution initials; or a source containing "..." or "et al.". Keep credentials, correspondence marks, equal-contribution marks, and superscript affiliation markers out of the label unless visibly part of the person name.', items: author },
            affiliations: { type: 'array', description: 'Every complete visible institutional affiliation as one separate item, including affiliations printed later in a dedicated Affiliations section. Split semicolon-separated complete affiliations. Exclude superscript markers alone, author superscript groups, correspondence lines, contribution initials, and abbreviations. If only author superscripts are visible but complete institutional statements are absent, return an empty array.', items: sourceItem },
            author_affiliation_links: { type: 'array', description: 'Every visibly supported link between authors and complete affiliations returned in this same response, based on printed superscripts or unambiguous layout. Return an empty array when either side is absent or the relationship is not visible.', items: link },
            keywords: { type: 'array', description: 'Every individual keyword from an explicitly labelled Keywords, Key words, or equivalent field. Split only on visible separators such as semicolons, line breaks, or labelled-list punctuation. Preserve short final acronyms such as DDDI. Never infer keywords from a title, abstract, highlights, affiliations, or body text. item_exact_quote must be the exact individual keyword and source.exact_quote must be a unique contiguous phrase from the keyword-list block containing it.', items: sourceItem },
            abstracts: { type: 'array', maxItems: 1, description: 'Zero or one complete opening abstract record. Treat a printed Summary before Introduction, a clinical structured abstract, or a compact unlabeled research-summary block placed after title/authors and before the first main section as the abstract. Anchor one record at the Abstract or Summary label, first structured-abstract label, or first complete abstract paragraph. Never return one record per paragraph.', items: abstract }
          }
        },
        body: {
          type: 'object',
          description: 'Printed article structure and narrative-prose classifications for the manuscript body.',
          additionalProperties: false,
          required: ['sections', 'prose_block_types', 'display_mentions'],
          properties: {
            sections: { type: 'array', description: 'Every actual printed article section heading in reading order, with its visible hierarchy. Include true nested subsection headings. Exclude table and figure captions, labels beginning with Fig., Figure, Table, Scheme, Box, Extended Data, or Supplementary Fig./Table, display titles, bibliography entries, body sentences, line numbers, running material, and isolated bold text.', items: section },
            display_mentions: { type: 'array', description: 'Every complete exact narrative-prose mention of a table or figure. Do not return bibliographic citations here.', items: bodyMention },
            prose_block_types: {
              type: 'object',
              additionalProperties: false,
              properties: {},
              description: 'Classify every supplied prose-block key exactly once as abstract, article, or excluded. Use abstract for every complete narrative block belonging to the printed, Summary, structured, or clearly positioned unlabeled opening abstract; abstract headings are excluded. Use article only for complete continuous narrative prose in the article body. Exclude title/front matter, highlights, impact statements, graphical abstracts, running material, headers, footers, page numbers, captions, tables, figures, equations, bibliography, acknowledgements, contributions, funding/support, disclosures, declarations, data-sharing statements, and supplementary material. Never select partial blocks, combined ranges, samples, or summaries.'
            }
          }
        },
        displays: {
          type: 'object',
          description: 'Actual captioned tables and figures visible in the supplied OCR pages.',
          additionalProperties: false,
          required: ['entries'],
          properties: { entries: { type: 'array', description: 'Every actual table or figure caption visible in caption, table, and image blocks, in manuscript order. Do not leave this empty when visible caption blocks identify displays. Exclude in-text mentions and uncaptioned decorative images.', items: display } }
        }
      }
    }
  }
};

const documentAnnotationPromptLines = [
  'Return only visible information from the supplied PDF pages. Never summarize, infer, repair text, use external knowledge, or return information that is not visibly grounded in the PDF.',
  'Every source is a navigation and counting anchor. For every source, copy ocr_page_id and ocr_block_id exactly from the compact locator map. exact_quote must be a short, plain-text, exact phrase visibly present in the PDF. Never return guessed locations, markdown, HTML, or an entire table as a source.',
  'Follow every field-specific instruction in document_annotation_format exactly. Return every required array and object. Use [] only when the supplied PDF pages contain no matching visible item, preserve printed order, and never repeat the same visible manuscript item.'
];

export const documentAnnotationPromptInstructions = [...documentAnnotationPromptLines];
export const documentAnnotationPrompt = documentAnnotationPromptLines.join(' ');

function stableHash(value = '') {
  let hash = 5381;
  for (const character of String(value)) hash = ((hash << 5) + hash + character.charCodeAt(0)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

export const documentAnnotationContractHash = stableHash(`${JSON.stringify(documentAnnotationFormat.json_schema.schema)}\n${documentAnnotationPrompt}`);

function constrainSourceIdentifiers(value, pageIds, blockIds, proseBlockKeys) {
  if (!value || typeof value !== 'object') return;
  if (value.properties?.ocr_page_id) {
    value.properties.ocr_page_id = {
      ...value.properties.ocr_page_id,
      enum: [...pageIds],
      description: `Opaque raw OCR page identifier. Allowed values for this request: ${pageIds.join(', ')}.`
    };
  }
  if (value.properties?.ocr_block_id) {
    value.properties.ocr_block_id = {
      ...value.properties.ocr_block_id,
      enum: [...blockIds],
      description: 'Opaque raw OCR block identifier. Choose only an identifier listed in the request source-block map.'
    };
  }
  if (value.properties?.prose_block_types) {
    const description = value.properties.prose_block_types.description;
    value.properties.prose_block_types = {
      ...value.properties.prose_block_types,
      properties: Object.fromEntries(proseBlockKeys.map((key) => [key, { type: 'string', enum: ['abstract', 'article', 'excluded'], description: 'Classify this complete raw OCR block exactly once.' }])),
      required: [...proseBlockKeys],
      description
    };
  }
  Object.values(value).forEach((child) => {
    if (child && typeof child === 'object') constrainSourceIdentifiers(child, pageIds, blockIds, proseBlockKeys);
  });
}

function compactText(value = '') {
  return String(value)
    .replace(/!\[[^\]]*\]\([^\n)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[\*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function blocksForPage(page = {}) {
  const blocks = Array.isArray(page.blocks) ? page.blocks.filter((block) => block && typeof block.content === 'string') : [];
  if (blocks.length) return blocks;
  const content = String(page.markdown || page.content || '');
  return content ? [{ type: 'text', content }] : [];
}

export function ocrBlockId(pageIndex, blockIndex) {
  return `ocr-block-${pageIndex}-${blockIndex}`;
}

function uniqueProseAnchors(rawPages = [], pages = []) {
  const candidates = pages.flatMap((pageIndex) => blocksForPage(rawPages[pageIndex]).flatMap((block, blockIndex) => {
    if (String(block.type || '').toLowerCase() !== 'text') return [];
    return [{ pageIndex, blockIndex, words: compactText(block.content).split(' ').filter(Boolean) }];
  }));
  return new Map(candidates.map((candidate) => {
    const choices = [10, 16, 24, 32];
    const anchor = choices.map((length) => candidate.words.slice(0, length).join(' ')).find((value) => value && candidates.filter((other) => compactText(rawPages[other.pageIndex]?.blocks?.[other.blockIndex]?.content || '').includes(value)).length === 1) || '';
    return [`${candidate.pageIndex}:${candidate.blockIndex}`, anchor];
  }));
}

/** A direct projection of OCR4 block locations. It makes source IDs unambiguous to Mistral. */
export function documentAnnotationSourcePageMap(rawPages = [], pages = []) {
  const proseAnchors = uniqueProseAnchors(rawPages, pages);
  return pages.map((pageIndex) => {
    const blocks = blocksForPage(rawPages[pageIndex]);
    return {
      id: `ocr-page-${pageIndex}`,
      blocks: blocks.map((block, blockIndex) => {
        const words = compactText(block.content).split(' ').filter(Boolean);
        return {
          id: ocrBlockId(pageIndex, blockIndex),
          type: String(block.type || 'text'),
          begins: words.slice(0, 14).join(' '),
          ends: words.slice(-10).join(' '),
          prose_block_key: proseAnchors.get(`${pageIndex}:${blockIndex}`) ? `${ocrBlockId(pageIndex, blockIndex)} :: ${proseAnchors.get(`${pageIndex}:${blockIndex}`)}` : ''
        };
      })
    };
  });
}

/** Returns the exact compact schema constrained to the request's raw OCR source IDs. */
export function documentAnnotationFormatForPages(pages = [], sourcePageMap = []) {
  if (!Array.isArray(pages) || !pages.length || !pages.every((page) => Number.isInteger(page) && page >= 0)) throw new TypeError('Document annotation requires explicit zero-based OCR page indexes.');
  const pageIds = pages.map((page) => `ocr-page-${page}`);
  const blockIds = sourcePageMap
    .filter((page) => pageIds.includes(page?.id))
    .flatMap((page) => Array.isArray(page.blocks) ? page.blocks.map((block) => block?.id).filter(Boolean) : []);
  const proseBlockKeys = sourcePageMap
    .filter((page) => pageIds.includes(page?.id))
    .flatMap((page) => Array.isArray(page.blocks) ? page.blocks.map((block) => block?.prose_block_key).filter(Boolean) : []);
  if (!blockIds.length) throw new TypeError('Document annotation requires an explicit raw OCR source-block map.');
  const format = structuredClone(documentAnnotationFormat);
  constrainSourceIdentifiers(format.json_schema.schema, pageIds, blockIds, proseBlockKeys);
  return format;
}

/** Adds exact raw OCR source identifiers without expanding the annotation scope. */
export function documentAnnotationPromptForPages(pages = [], sourcePageMap = []) {
  const pageIds = pages.map((page) => `ocr-page-${page}`);
  const pageMap = sourcePageMap
    .filter((page) => pageIds.includes(page?.id))
    .map((page) => `${page.id}: ${(page.blocks || []).map((block) => `${block.id} [${block.type}] begins “${String(block.begins || '').slice(0, 110)}” ends “${String(block.ends || '').slice(0, 80)}”`).join('; ')}`)
    .join(' | ');
  return [
    documentAnnotationPrompt,
    `This request contains only these raw OCR page IDs: [${pageIds.join(', ')}].`,
    `Compact source-block locator map: ${pageMap || 'No raw OCR block locators were supplied.'}`,
    'Use the PDF as the manuscript source. The locator map exists only so returned source IDs can use DeskReview page and block identifiers. Copy source.exact_quote verbatim from the PDF; DeskReview validates it against the separately cached raw OCR response.'
  ].join(' ');
}
