import assert from 'node:assert/strict';
import {
  referenceAnnotationFormat,
  referenceAnnotationIssues,
  referenceAnnotationPrompt,
  referenceAnnotationPages,
  referenceBlocksFromRawPages
} from '../core/reference-annotation.js';

const pages = Array.from({ length: 12 }, (_, pageIndex) => ({
  blocks: pageIndex >= 3 && pageIndex <= 5
    ? [{ type: 'references', content: `Reference block ${pageIndex}` }]
    : [{ type: 'text', content: `Body ${pageIndex}` }]
}));
const blocks = referenceBlocksFromRawPages(pages);
assert.deepEqual(blocks.map((block) => block.blockId), ['ocr-block-3-0', 'ocr-block-4-0', 'ocr-block-5-0']);
assert.deepEqual(referenceAnnotationPages(blocks), [3, 4, 5]);

const format = referenceAnnotationFormat(blocks);
assert.deepEqual(
  format.json_schema.schema.properties.references.items.properties.source.properties.ocr_block_id.enum,
  ['ocr-block-3-0', 'ocr-block-4-0', 'ocr-block-5-0']
);
assert.deepEqual(Object.keys(format.json_schema.schema.properties), ['references']);
assert.match(referenceAnnotationPrompt(blocks), /BEGIN ocr-page-3 ocr-block-3-0/);
assert.match(referenceAnnotationPrompt(blocks), /Reference block 5/);

const valid = {
  references: [{
    id: 'ref-1',
    text: 'Reference block 3',
    source: { ocr_page_id: 'ocr-page-3', ocr_block_id: 'ocr-block-3-0', exact_quote: 'Reference block 3' }
  }]
};
assert.deepEqual(referenceAnnotationIssues(valid, blocks), []);
assert.match(referenceAnnotationIssues({
  references: [{
    id: 'ref-1',
    text: 'Reference block 3',
    source: { ocr_page_id: 'ocr-page-3', ocr_block_id: 'ocr-block-3-0', exact_quote: 'not present' }
  }]
}, blocks)[0], /ungrounded/);
assert.throws(() => referenceAnnotationPages([
  ...blocks,
  ...Array.from({ length: 6 }, (_, index) => ({ pageIndex: index + 6 }))
]), /eight/);

console.log('reference annotation: ok');
