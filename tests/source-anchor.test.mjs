import assert from 'node:assert/strict';
import { validateDeclaredSource } from '../core/source-anchor.js';

const pages = [
  { markdown: 'First page contains Alpha anchor.' },
  { markdown: 'Second page contains Beta anchor.', tables: [{ content: '<table><tr><td>Table anchor</td></tr></table>' }] }
];

assert.deepEqual(
  validateDeclaredSource(pages, { source: { page_number: 2, exact_quote: 'Beta anchor' } }),
  { pageNumber: 2, quote: 'Beta anchor' }
);
assert.deepEqual(
  validateDeclaredSource(pages, { source: { ocr_page_id: 'ocr-page-1', exact_quote: 'Beta anchor' } }),
  { pageNumber: 2, quote: 'Beta anchor' }
);
assert.deepEqual(
  validateDeclaredSource([{ blocks: [{ content: 'Alpha block' }, { content: 'Beta block' }] }], { source: { ocr_page_id: 'ocr-page-0', ocr_block_id: 'ocr-block-0-1', exact_quote: 'Beta block' } }),
  { pageNumber: 1, blockIndex: 1, quote: 'Beta block' }
);
assert.equal(validateDeclaredSource([{ blocks: [{ content: 'Alpha block' }, { content: 'Beta block' }] }], { source: { ocr_page_id: 'ocr-page-0', ocr_block_id: 'ocr-block-0-0', exact_quote: 'Beta block' } }), null);
assert.deepEqual(
  validateDeclaredSource(pages, { source: { ocr_page_index: 1, exact_quote: 'Beta anchor' } }),
  { pageNumber: 2, quote: 'Beta anchor' }
);
assert.deepEqual(
  validateDeclaredSource(pages, { source: { exact_quote: 'Alpha anchor' } }),
  { pageNumber: 1, quote: 'Alpha anchor' }
);
assert.equal(validateDeclaredSource([{ blocks: [{ content: 'Repeated anchor' }] }, { blocks: [{ content: 'Repeated anchor' }] }], { source: { exact_quote: 'Repeated anchor' } }), null);
assert.deepEqual(
  validateDeclaredSource([{ markdown: '**Keywords**:\nKidney transplantation\nUrology' }], { source: { ocr_page_index: 0, exact_quote: 'Keywords: Kidney transplantation Urology' } }),
  { pageNumber: 1, quote: 'Keywords: Kidney transplantation Urology' }
);
assert.deepEqual(
  validateDeclaredSource([{ markdown: 'Keywords:\nKidney transplantation\nUrology', blocks: [{ content: 'Keywords:' }, { content: 'Kidney transplantation\nUrology' }] }], { source: { exact_quote: 'Keywords: Kidney transplantation Urology' } }),
  { pageNumber: 1, quote: 'Keywords: Kidney transplantation Urology' }
);
assert.deepEqual(
  validateDeclaredSource(pages, { source: { page_number: 2, exact_quote: 'Table anchor' } }),
  { pageNumber: 2, quote: 'Table anchor' }
);
assert.equal(validateDeclaredSource(pages, { source: { page_number: 1, exact_quote: 'Beta anchor' } }), null);
assert.equal(validateDeclaredSource(pages, { source: { page_number: 3, exact_quote: 'Beta anchor' } }), null);
assert.equal(validateDeclaredSource([{ markdown: 'Repeated anchor' }, { markdown: 'Repeated anchor' }], { source: { page_number: 3, exact_quote: 'Repeated anchor' } }), null);
assert.equal(validateDeclaredSource(pages, { source: { page_number: 2, exact_quote: '' } }), null);
console.log('source anchor contract: ok');
