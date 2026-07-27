import assert from 'node:assert/strict';
import { documentAnnotationFormat, documentAnnotationPrompt } from '../core/document-annotation.js';
import { analysePayload } from '../server/analysis-service.js';
import { createRequestGuard } from '../server/request-guard.js';

const pdf = Buffer.from('%PDF-1.4\nfixture').toString('base64');
let requestBody;
const response = await analysePayload({ fileName: 'fixture.pdf', base64: pdf }, {
  env: { MISTRAL_API_KEY: 'test-key', MISTRAL_BASE_URL: 'https://example.test', MISTRAL_OCR_TIMEOUT_MS: '1000' },
  fetchImpl: async (_url, request) => {
    requestBody = JSON.parse(request.body);
    return new Response(JSON.stringify({ pages: [{ markdown: 'Fixture page' }], document_annotation: { front_matter: { title: { text: 'Fixture', source: { page_number: 1, exact_quote: 'Fixture' } }, authors: [], affiliations: [], keywords: [], abstract: { text: '', word_count: 0, source: { page_number: 1, exact_quote: 'Fixture' } } }, body: { sections: [], display_items: [] }, references: { references: [] } } }), { status: 200 });
  }
});
assert.equal(response.status, 200);
assert.deepEqual(requestBody.document_annotation_format, documentAnnotationFormat);
assert.equal(requestBody.document_annotation_prompt, documentAnnotationPrompt);
assert.equal(requestBody.document.type, 'document_url');
assert.equal((await analysePayload({ base64: 'not a pdf' }, { env: { MISTRAL_API_KEY: 'test-key' } })).status, 400);

let time = 0;
const productionGuard = createRequestGuard({ env: { NODE_ENV: 'production', APP_ORIGIN: 'https://deskreview.ai', OCR_RATE_LIMIT_MAX: '1', OCR_RATE_LIMIT_WINDOW_MS: '60000' }, now: () => time });
const request = { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://deskreview.ai' }, socket: { remoteAddress: '127.0.0.1' } };
const lease = productionGuard.acquire(request);
assert.ok(lease.release);
lease.release();
assert.equal(productionGuard.acquire(request).rejected.status, 429);
assert.equal(createRequestGuard({ env: { NODE_ENV: 'production', APP_ORIGIN: 'https://deskreview.ai' } }).acquire({ ...request, headers: { 'content-type': 'application/json', origin: 'https://evil.example' } }).rejected.status, 403);
assert.equal(createRequestGuard({ env: { NODE_ENV: 'production', APP_ORIGIN: 'https://deskreview.ai' } }).acquire({ ...request, headers: { 'content-type': 'text/plain', origin: 'https://deskreview.ai' } }).rejected.status, 415);
console.log('server contract: ok');
