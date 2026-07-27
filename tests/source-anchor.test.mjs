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
  validateDeclaredSource(pages, { source: { page_number: 2, exact_quote: 'Table anchor' } }),
  { pageNumber: 2, quote: 'Table anchor' }
);
assert.equal(validateDeclaredSource(pages, { source: { page_number: 1, exact_quote: 'Beta anchor' } }), null);
assert.equal(validateDeclaredSource(pages, { source: { page_number: 3, exact_quote: 'Beta anchor' } }), null);
assert.equal(validateDeclaredSource(pages, { source: { page_number: 2, exact_quote: '' } }), null);
console.log('source anchor contract: ok');

