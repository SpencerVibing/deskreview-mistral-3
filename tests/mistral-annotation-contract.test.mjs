import assert from 'node:assert/strict';
import { MISTRAL_ANNOTATION_MAX_PAGES, annotationPageRanges, assertAnnotationPageRange, assertCompactAnnotationFormat } from '../core/mistral-annotation-contract.js';
import { documentAnnotationContractHash, documentAnnotationContractVersion, documentAnnotationFormat, documentAnnotationFormatForPages, documentAnnotationPrompt, documentAnnotationPromptForPages, documentAnnotationSourcePageMap } from '../core/document-annotation.js';
import { documentAnnotationIssues } from '../core/document-annotation-validation.js';

assert.equal(MISTRAL_ANNOTATION_MAX_PAGES, 8);
assert.deepEqual(annotationPageRanges(17), [[0, 1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14, 15], [16]]);
assert.deepEqual(assertAnnotationPageRange([8, 9, 10]), [8, 9, 10]);
assert.throws(() => assertAnnotationPageRange([0, 2]), /sequential/);
assert.throws(() => assertAnnotationPageRange(Array.from({ length: 9 }, (_, index) => index)), /1-8/);

const compact = { type: 'json_schema', json_schema: { schema: { type: 'object', properties: { entries: { type: 'array', items: { type: 'object', properties: { source: { type: 'object', required: ['ocr_page_id', 'ocr_block_id', 'exact_quote'], properties: { ocr_page_id: { type: 'string' }, ocr_block_id: { type: 'string' }, exact_quote: { type: 'string' } } } } } } } } } };
assert.equal(assertCompactAnnotationFormat(compact), compact);
assert.equal(assertCompactAnnotationFormat(documentAnnotationFormat), documentAnnotationFormat);
const sourcePageMap = [8, 9, 10].map((page) => ({ id: `ocr-page-${page}`, blocks: [{ id: `ocr-block-${page}-0`, type: 'text', begins: 'Fixture page', ends: 'Fixture page', prose_block_key: `ocr-block-${page}-0 :: Fixture page ${page}` }] }));
const pageBoundFormat = documentAnnotationFormatForPages([8, 9, 10], sourcePageMap);
assert.equal(documentAnnotationContractVersion, 'deskreview_document_annotation_v16');
assert.match(documentAnnotationContractHash, /^[0-9a-f]{8}$/);
assert.match(documentAnnotationPrompt, /copy ocr_page_id and ocr_block_id exactly/);
assert.match(documentAnnotationPrompt, /supplied PDF pages/);
assert.match(documentAnnotationPrompt, /Follow every field-specific instruction in document_annotation_format exactly/);
assert.doesNotMatch(documentAnnotationPrompt, /For front_matter\.authors/);
assert.doesNotMatch(documentAnnotationPrompt, /For front_matter\.affiliations/);
assert.doesNotMatch(documentAnnotationPrompt, /For titles and keywords/);
assert.match(documentAnnotationFormat.json_schema.schema.properties.front_matter.properties.authors.description, /one separate item/);
assert.match(documentAnnotationFormat.json_schema.schema.properties.front_matter.properties.authors.items.description, /Never combine multiple people/);
assert.match(documentAnnotationFormat.json_schema.schema.properties.front_matter.properties.keywords.description, /DDDI/);
assert.match(documentAnnotationFormat.json_schema.schema.properties.body.properties.sections.description, /printed article section heading/);
assert.equal(documentAnnotationFormat.json_schema.schema.properties.body.properties.citation_mentions, undefined);
assert.match(documentAnnotationFormat.json_schema.schema.properties.displays.properties.entries.description, /Every actual table or figure caption/);
assert.doesNotMatch(documentAnnotationPrompt, /bibliography\.blocks/);
assert.doesNotMatch(documentAnnotationPrompt, /body\.reference_mentions/);
assert.deepEqual(Object.keys(pageBoundFormat.json_schema.schema.properties.front_matter.properties.titles.items.properties.source.properties), ['ocr_page_id', 'ocr_block_id', 'exact_quote']);
assert.deepEqual(pageBoundFormat.json_schema.schema.properties.front_matter.properties.titles.items.properties.source.required, ['ocr_page_id', 'ocr_block_id', 'exact_quote']);
assert.deepEqual(pageBoundFormat.json_schema.schema.properties.front_matter.properties.titles.items.properties.source.properties.ocr_page_id.enum, ['ocr-page-8', 'ocr-page-9', 'ocr-page-10']);
assert.deepEqual(pageBoundFormat.json_schema.schema.properties.front_matter.properties.titles.items.properties.source.properties.ocr_block_id.enum, ['ocr-block-8-0', 'ocr-block-9-0', 'ocr-block-10-0']);
assert.deepEqual(Object.keys(pageBoundFormat.json_schema.schema.properties.body.properties.prose_block_types.properties), ['ocr-block-8-0 :: Fixture page 8', 'ocr-block-9-0 :: Fixture page 9', 'ocr-block-10-0 :: Fixture page 10']);
assert.equal(pageBoundFormat.json_schema.schema.properties.body.properties.prose_block_types.additionalProperties, false);
assert.deepEqual(pageBoundFormat.json_schema.schema.properties.body.properties.prose_block_types.required, ['ocr-block-8-0 :: Fixture page 8', 'ocr-block-9-0 :: Fixture page 9', 'ocr-block-10-0 :: Fixture page 10']);
const noProseSourceMap = [{ id: 'ocr-page-16', blocks: [{ id: 'ocr-block-16-0', type: 'heading', begins: 'References', ends: 'References', prose_block_key: '' }, { id: 'ocr-block-16-1', type: 'references', begins: '1 Late reference', ends: 'Late reference', prose_block_key: '' }] }];
const noProseFormat = documentAnnotationFormatForPages([16], noProseSourceMap);
assert.deepEqual(Object.keys(noProseFormat.json_schema.schema.properties.body.properties.prose_block_types.properties), []);
assert.deepEqual(noProseFormat.json_schema.schema.properties.body.properties.prose_block_types.required, []);
assert.equal(noProseFormat.json_schema.schema.properties.bibliography, undefined);
assert.doesNotMatch(documentAnnotationPromptForPages([16], noProseSourceMap), /1\. Late reference\./);
assert.deepEqual(Object.keys(documentAnnotationFormat.json_schema.schema.properties), ['front_matter', 'body', 'displays']);
assert.equal(documentAnnotationFormat.json_schema.schema.properties.body.properties.reference_mentions, undefined);
assert.deepEqual(documentAnnotationSourcePageMap([{ blocks: [{ type: 'title', content: '# Heading\n\nFirst words\n\nLast words' }, { type: 'text', content: 'Narrative text begins here and continues with distinct source content.' }] }], [0]), [{ id: 'ocr-page-0', blocks: [{ id: 'ocr-block-0-0', type: 'title', begins: 'Heading First words Last words', ends: 'Heading First words Last words', prose_block_key: '' }, { id: 'ocr-block-0-1', type: 'text', begins: 'Narrative text begins here and continues with distinct source content.', ends: 'Narrative text begins here and continues with distinct source content.', prose_block_key: 'ocr-block-0-1 :: Narrative text begins here and continues with distinct source content.' }] }]);
assert.doesNotMatch(documentAnnotationPromptForPages([8, 9, 10], sourcePageMap), /AUTHORITATIVE RAW OCR BLOCKS/);
assert.doesNotMatch(documentAnnotationPromptForPages([8, 9, 10], sourcePageMap), /prose-block key/);
assert.match(documentAnnotationPromptForPages([8, 9, 10], sourcePageMap), /ocr-page-8: ocr-block-8-0/);
const bloated = structuredClone(compact);
bloated.json_schema.schema.properties.markdown = { type: 'string' };
assert.throws(() => assertCompactAnnotationFormat(bloated), /duplicates raw OCR fields/);
const missingPageBlock = structuredClone(compact);
delete missingPageBlock.json_schema.schema.properties.entries.items.properties.source.properties.ocr_page_id;
assert.throws(() => assertCompactAnnotationFormat(missingPageBlock), /OCR page and block identifiers/);
const optionalPageBlock = structuredClone(compact);
optionalPageBlock.json_schema.schema.properties.entries.items.properties.source.required = ['exact_quote'];
assert.throws(() => assertCompactAnnotationFormat(optionalPageBlock), /must require OCR page, block, and quote/);

const exactCitationFixture = {
  front_matter: { titles: [], authors: [], affiliations: [], author_affiliation_links: [], keywords: [], abstracts: [] },
  body: {
    sections: [],
    prose_block_types: {},
    display_mentions: []
  },
  displays: { entries: [] }
};
assert.deepEqual(documentAnnotationIssues(exactCitationFixture), []);
console.log('mistral annotation contract: ok');
