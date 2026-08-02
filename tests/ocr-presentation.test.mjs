import assert from 'node:assert/strict';
import { hasLineNumberGutter, ocrMarkdownForPresentation } from '../core/ocr-presentation.js';

const lineNumberedPage = {
  markdown: '1\n\n2 Title:\n\n3 Modeling\n4 Earthquakes\n\n18\n\n19\n\n20\n\n21\n\n22',
  blocks: [
    { top_left_x: 37, content: '1' },
    { top_left_x: 37, content: '2 Title:' },
    { top_left_x: 37, content: '3 Modeling\n4 Earthquakes' },
    ...[18, 19, 20, 21, 22].map((number) => ({ top_left_x: 31, content: String(number) }))
  ]
};
assert.equal(hasLineNumberGutter(lineNumberedPage.blocks), true);
assert.equal(ocrMarkdownForPresentation(lineNumberedPage), 'Title:\n\nModeling\nEarthquakes');

const groupedLineNumberGutterPage = {
  markdown: '51\n52\n53\n54\n55\n\n# Title',
  blocks: [{ top_left_x: 29, content: '51\n52\n53\n54\n55' }, { top_left_x: 90, content: '# Title' }]
};
assert.equal(hasLineNumberGutter(groupedLineNumberGutterPage.blocks), true);
assert.equal(ocrMarkdownForPresentation(groupedLineNumberGutterPage), '# Title');

const numberedSectionPage = {
  markdown: '1 Introduction\n\n1. Study design',
  blocks: [{ top_left_x: 80, content: '1 Introduction' }, { top_left_x: 80, content: '1. Study design' }]
};
assert.equal(hasLineNumberGutter(numberedSectionPage.blocks), false);
assert.equal(ocrMarkdownForPresentation(numberedSectionPage), numberedSectionPage.markdown);

console.log('OCR presentation: ok');
