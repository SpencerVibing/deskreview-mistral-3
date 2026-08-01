import assert from 'node:assert/strict';
import {
  referenceAnnotationCoverage,
  referenceAnnotationFormat,
  referenceAnnotationIssues,
  referenceAnnotationPrompt,
  referenceAnnotationPromptInstructions,
  referenceAnnotationPages,
  referenceAnnotationReferences,
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
  format.json_schema.schema.properties.references.items.required,
  ['id', 'printed_label', 'text']
);
assert.deepEqual(Object.keys(format.json_schema.schema.properties), ['references']);
assert.equal('reference_blocks' in format.json_schema.schema.properties, false);
assert.match(referenceAnnotationPrompt(blocks), /BEGIN ocr-page-3 ocr-block-3-0/);
assert.match(referenceAnnotationPrompt(blocks), /Reference block 5/);
assert.ok(referenceAnnotationPromptInstructions.every((instruction) => referenceAnnotationPrompt(blocks).includes(instruction)));

const valid = {
  references: [{ id: 'ref-1', printed_label: '', text: 'Reference block 3\nReference block 4\nReference block 5' }]
};
assert.deepEqual(referenceAnnotationIssues(valid, blocks), []);
assert.deepEqual(referenceAnnotationReferences(valid), [{
  id: 'ref-1',
  printed_label: '',
  text: 'Reference block 3\nReference block 4\nReference block 5'
}]);
assert.equal(referenceAnnotationCoverage(valid, blocks).ratio, 1);
const multiReferenceBlock = [{
  pageIndex: 3,
  pageId: 'ocr-page-3',
  blockIndex: 0,
  blockId: 'ocr-block-3-0',
  text: '1. First reference.\n\n2. Second reference.\n\n3. Third reference.'
}];
assert.match(referenceAnnotationIssues({
  references: [{ id: 'ref-1', printed_label: '1.', text: 'First reference.' }]
}, multiReferenceBlock).join(' '), /covers only 32.7%/);
assert.match(referenceAnnotationIssues({
  references: [{ id: 'ref-1', printed_label: '', text: 'Reference block 3' }, { id: 'ref-1', printed_label: '', text: 'Reference block 4\nReference block 5' }]
}, blocks).join(' '), /repeats identifier/);
assert.throws(() => referenceAnnotationPages([
  ...blocks,
  ...Array.from({ length: 6 }, (_, index) => ({ pageIndex: index + 6 }))
]), /eight/);

console.log('reference annotation: ok');
