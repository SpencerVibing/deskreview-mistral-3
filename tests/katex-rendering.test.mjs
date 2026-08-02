import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.DESKREVIEW_M3_BASE_URL || 'http://127.0.0.1:8893';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(baseUrl);
const result = await page.evaluate(async () => {
  const { inlineMarkdown } = await import('/app/markdown.js');
  const { default: renderMathInElement } = await import('/vendor/katex/contrib/auto-render.mjs');
  const root = document.createElement('div');
  root.innerHTML = inlineMarkdown(String.raw`\[ E  _ {o} = \frac {e Q _ {a} Z _ {a} g}{2 \sigma _ {o} v _ {a}} \tag {15} \] \( e = 1.6023 \times 10^{-19} C \)`);
  renderMathInElement(root, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false }
    ],
    throwOnError: false,
    strict: 'ignore'
  });
  return {
    display: root.querySelectorAll('.katex-display').length,
    math: root.querySelectorAll('.katex').length,
    rawDelimiter: root.textContent.includes('\\[') || root.textContent.includes('\\('),
    accidentalItalicMarker: root.textContent.includes('*{')
  };
});

assert.equal(result.display, 1);
assert.equal(result.math, 2);
assert.equal(result.rawDelimiter, false);
assert.equal(result.accidentalItalicMarker, false);

await browser.close();
console.log('KaTeX OCR rendering: ok');
