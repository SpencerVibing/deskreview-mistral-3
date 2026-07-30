import assert from 'node:assert/strict';
import { countArticleWordsFromBlocks, countArticleWordsFromRanges, wordCountProvenanceFromBlocks, wordCountTokenizer } from '../core/article-word-count.js';

const source = (ocr_page_index, exact_quote) => ({ ocr_page_index, exact_quote });
const pages = [
  { blocks: [{ content: 'Cover material' }, { content: 'Alpha beta gamma.' }, { content: 'Table 1 caption' }] },
  { blocks: [{ content: 'Delta epsilon.' }, { content: 'References' }] }
];
const ranges = [
  { start: source(0, 'Alpha beta'), end: source(0, 'beta gamma.') },
  { start: source(1, 'Delta'), end: source(1, 'epsilon.') }
];

assert.deepEqual(countArticleWordsFromRanges(pages, ranges), { valid: true, count: 5 });
assert.deepEqual(
  countArticleWordsFromRanges([{ markdown: '## **Methods**\n\nAlpha [linked words](https://example.test) gamma.' }], [{ start: source(0, 'Methods Alpha linked words'), end: source(0, 'linked words gamma.') }]),
  { valid: true, count: 5 }
);
assert.equal(countArticleWordsFromRanges(pages, [{ start: source(0, 'Missing'), end: source(0, 'gamma.') }]).valid, false);
assert.equal(countArticleWordsFromRanges(pages, [{ start: source(0, 'Alpha'), end: source(0, 'gamma.') }, { start: source(0, 'beta'), end: source(0, 'gamma.') }]).valid, false);
assert.equal(countArticleWordsFromRanges(pages, []).valid, false);
assert.deepEqual(countArticleWordsFromRanges([{ markdown: 'State-of-the-art authors\' work uses 95% confidence.' }], [{ start: source(0, 'State-of-the-art'), end: source(0, 'confidence.') }]), { valid: true, count: 6 });

const blockPages = [{ blocks: [{ content: 'Alpha beta gamma.' }, { content: 'Table 1 is not article prose.' }] }, { blocks: [{ content: 'Delta epsilon.' }] }];
assert.deepEqual(
  countArticleWordsFromBlocks(blockPages, [{ id: 'p1', raw_ocr_anchor: 'Alpha beta gamma' }, { id: 'p2', raw_ocr_anchor: 'Delta epsilon' }]),
  { valid: true, count: 5 }
);
assert.deepEqual(
  countArticleWordsFromBlocks(blockPages, ['ocr-block-0-0 :: Alpha beta gamma', 'ocr-block-1-0 :: Delta epsilon']),
  { valid: true, count: 5 }
);
assert.deepEqual(
  wordCountProvenanceFromBlocks(blockPages, ['ocr-block-0-0 :: Alpha beta gamma', 'ocr-block-1-0 :: Delta epsilon']),
  { valid: true, count: 5, block_ids: ['ocr-block-0-0', 'ocr-block-1-0'], fragments: ['Alpha beta gamma.', 'Delta epsilon.'], tokenizer: wordCountTokenizer }
);
const provenance = wordCountProvenanceFromBlocks(blockPages, ['ocr-block-0-0 :: Alpha beta gamma', 'ocr-block-1-0 :: Delta epsilon']);
assert.equal(wordCountProvenanceFromBlocks(blockPages, provenance.block_ids).count, provenance.count);
assert.deepEqual(countArticleWordsFromBlocks(blockPages, ['ocr-block-0-0 :: Alpha beta gamma', 'ocr-block-0-0 :: Alpha beta gamma']), { valid: false, count: null });
assert.deepEqual(countArticleWordsFromBlocks(blockPages, [{ id: 'p1', raw_ocr_anchor: 'Missing' }]), { valid: false, count: null });
assert.deepEqual(countArticleWordsFromBlocks([{ blocks: [{ content: 'Shared anchor' }, { content: 'Shared anchor' }] }], [{ id: 'p1', raw_ocr_anchor: 'Shared anchor' }]), { valid: false, count: null });
assert.equal(wordCountProvenanceFromBlocks(blockPages, [{ summary: 'Alpha beta gamma. Delta epsilon.' }]).valid, false);
console.log('article word count: ok');
