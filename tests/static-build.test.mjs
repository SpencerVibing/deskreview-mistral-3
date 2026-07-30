import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const exists = async (path) => Boolean(await stat(join(root, path)).catch(() => null));

const html = await readFile(join(root, 'dist/index.html'), 'utf8');
assert.match(html, /\/vendor\/bootstrap\/css\/bootstrap\.min\.css/);
assert.match(html, /\/vendor\/bootstrap-icons\/bootstrap-icons\.min\.css/);
assert.match(html, /\/vendor\/bootstrap\/js\/bootstrap\.bundle\.min\.js/);
assert.equal(await exists('dist/app.js'), true);
assert.equal(await exists('dist/home.js'), true);
assert.equal(await exists('dist/core/source-anchor.js'), true);
assert.equal(await exists('dist/core/document-annotation.js'), true);
assert.equal(await exists('dist/core/annotation-stages.js'), true);
assert.equal(await exists('dist/vendor/pdfjs/build/pdf.mjs'), true);
assert.equal(await exists('dist/vendor/pdfjs/build/pdf.worker.mjs'), true);
assert.equal(await exists('dist/vendor/bootstrap/css/bootstrap.min.css'), true);
assert.equal(await exists('dist/vendor/bootstrap/js/bootstrap.bundle.min.js'), true);
assert.equal(await exists('dist/vendor/bootstrap-icons/bootstrap-icons.min.css'), true);

console.log('static build: ok');
