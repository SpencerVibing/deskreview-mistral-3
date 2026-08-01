import assert from 'node:assert/strict';
import { inlineMarkdown } from '../public/app/markdown.js';

assert.equal(
  inlineMarkdown('Hypertension affects over 60% of adults aged 55 years or older \\( ^{1} \\).'),
  'Hypertension affects over 60% of adults aged 55 years or older <sup>1</sup>.'
);
assert.equal(
  inlineMarkdown('Model term \\( _{2} \\).'),
  'Model term <sub>2</sub>.'
);
assert.equal(
  inlineMarkdown('The OCR text stays literal: <source>.'),
  'The OCR text stays literal: &lt;source&gt;.'
);

console.log('markdown rendering: ok');
