import assert from 'node:assert/strict';
import { documentAnnotationFormatForPages, documentAnnotationPromptForPages, documentAnnotationSourcePageMap } from '../core/document-annotation.js';
import { annotationChunkPayload, citationAnnotationPayload, displayLinksPayload, rawOcrPayload, referenceAnnotationPayload, referenceLinksPayload } from '../server/analysis-service.js';
import { createRequestGuard } from '../server/request-guard.js';

const pdf = Buffer.from('%PDF-1.4\nfixture').toString('base64');
const requests = [];
const source = (page, block, quote) => ({ ocr_page_id: `ocr-page-${page}`, ocr_block_id: `ocr-block-${page}-${block}`, exact_quote: quote });
const rawPages = Array.from({ length: 9 }, (_, index) => ({
  index,
  markdown: index === 7 ? 'Smith A. Fixture study.' : `Fixture page ${index}`,
  blocks: [{ type: index === 7 ? 'references' : 'text', content: index === 7 ? 'Smith A. Fixture study.' : `Fixture page ${index}` }]
}));
const emptyChunk = () => ({
  front_matter: { titles: [], authors: [], affiliations: [], author_affiliation_links: [], keywords: [], abstracts: [] },
  body: { sections: [], prose_block_types: {}, display_mentions: [] },
  displays: { entries: [] }
});

const rawResponse = await rawOcrPayload({ fileName: 'fixture.pdf', base64: pdf }, {
  env: { MISTRAL_API_KEY: 'test-key', MISTRAL_BASE_URL: 'https://example.test', MISTRAL_OCR_TIMEOUT_MS: '1000' },
  fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body);
    requests.push(body);
    return new Response(JSON.stringify({ pages: rawPages }), { status: 200 });
  }
});
assert.equal(rawResponse.status, 200);
assert.equal(requests.length, 1);
assert.equal(requests[0].document_annotation_format, undefined);
assert.equal(requests[0].pages, undefined);

const annotationRequests = [];
const annotationResponse = await annotationChunkPayload({ fileName: 'fixture.pdf', base64: pdf, pages: [0, 1, 2, 3, 4, 5, 6, 7], sourcePageMap: documentAnnotationSourcePageMap(rawPages, [0, 1, 2, 3, 4, 5, 6, 7]) }, {
  env: { MISTRAL_API_KEY: 'test-key', MISTRAL_BASE_URL: 'https://example.test', MISTRAL_OCR_TIMEOUT_MS: '1000' },
  fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body);
    annotationRequests.push(body);
    const annotation = emptyChunk();
    body.pages.filter((page) => page !== 7).forEach((page) => { annotation.body.prose_block_types[`ocr-block-${page}-0 :: Fixture page ${page}`] = 'excluded'; });
    annotation.front_matter.titles.push({ id: 'title', label: 'Fixture', item_exact_quote: 'Fixture', source: source(0, 0, 'Fixture') });
    annotation.front_matter.authors.push({ id: 'a1', label: 'Ada Author', orcid: '', source: source(0, 0, 'Fixture') });
    annotation.front_matter.affiliations.push({ id: 'f1', label: 'Compiler Lab', item_exact_quote: 'Fixture', source: source(0, 0, 'Fixture') });
    annotation.front_matter.author_affiliation_links.push({ author_id: 'a1', affiliation_id: 'f1' });
    annotation.front_matter.abstracts.push({ source: source(0, 0, 'Fixture') });
    annotation.body.sections.push({ id: 'methods', heading: 'Methods', level: 1, source: source(0, 0, 'Fixture') });
    annotation.body.prose_block_types['ocr-block-0-0 :: Fixture page 0'] = 'article';
    annotation.displays.entries.push({ id: 'table-1', kind: 'table', label: 'Table 1', source: source(0, 0, 'Fixture') });
    return new Response(JSON.stringify({ pages: [], document_annotation: annotation }), { status: 200 });
  }
});

assert.equal(annotationResponse.status, 200);
assert.equal(annotationRequests.length, 1);
const firstMap = documentAnnotationSourcePageMap(rawPages, [0, 1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual(annotationRequests[0].pages, [0, 1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual(annotationRequests[0].document_annotation_format, documentAnnotationFormatForPages([0, 1, 2, 3, 4, 5, 6, 7], firstMap));
assert.equal(annotationRequests[0].document_annotation_prompt, documentAnnotationPromptForPages([0, 1, 2, 3, 4, 5, 6, 7], firstMap));
assert.match(annotationRequests[0].document_annotation_prompt, /source-block locator map/);
assert.doesNotMatch(annotationRequests[0].document_annotation_prompt, /AUTHORITATIVE RAW OCR BLOCKS/);
assert.match(annotationRequests[0].document_annotation_prompt, /copy ocr_page_id and ocr_block_id exactly/);
assert.match(annotationRequests[0].document_annotation_prompt, /Follow every field-specific instruction in document_annotation_format exactly/);
assert.doesNotMatch(annotationRequests[0].document_annotation_prompt, /For front_matter\.authors/);
assert.doesNotMatch(annotationRequests[0].document_annotation_prompt, /bibliography\.blocks/);
assert.equal(annotationRequests[0].document_annotation_format.json_schema.schema.properties.bibliography, undefined);
assert.equal(annotationRequests[0].document_annotation_format.json_schema.schema.properties.body.properties.reference_mentions, undefined);
assert.deepEqual(Object.keys(annotationRequests[0].document_annotation_format.json_schema.schema.properties.front_matter.properties.titles.items.properties.source.properties), ['ocr_page_id', 'ocr_block_id', 'exact_quote']);
assert.deepEqual(annotationRequests[0].document_annotation_format.json_schema.schema.properties.front_matter.properties.titles.items.properties.source.required, ['ocr_page_id', 'ocr_block_id', 'exact_quote']);
assert.equal((await rawOcrPayload({ base64: 'not a pdf' }, { env: { MISTRAL_API_KEY: 'test-key' } })).status, 400);

const invalidAnnotationResponse = await annotationChunkPayload({ fileName: 'fixture.pdf', base64: pdf, pages: [0], sourcePageMap: documentAnnotationSourcePageMap(rawPages, [0]) }, {
  env: { MISTRAL_API_KEY: 'test-key', MISTRAL_BASE_URL: 'https://example.test', MISTRAL_OCR_TIMEOUT_MS: '1000' },
  fetchImpl: async () => {
    const annotation = emptyChunk();
    annotation.front_matter.authors.push({ id: 'a1', label: 'Ada Author', orcid: '', source: { exact_quote: 'Ada Author' } });
    return new Response(JSON.stringify({ pages: [], document_annotation: annotation }), { status: 200 });
  }
});
assert.equal(invalidAnnotationResponse.status, 502);

let citationRequest;
const citationResponse = await citationAnnotationPayload({ fileName: 'fixture.pdf', base64: pdf, pages: [0] }, {
  env: { MISTRAL_API_KEY: 'test-key', MISTRAL_BASE_URL: 'https://example.test', MISTRAL_OCR_TIMEOUT_MS: '1000' },
  fetchImpl: async (_url, request) => {
    citationRequest = JSON.parse(request.body);
    return new Response(JSON.stringify({
      document_annotation: {
        citation_mentions: [{ label: '(Smith, 2024)', context_quote: 'Prior work (Smith, 2024) found this.' }]
      }
    }), { status: 200 });
  }
});
assert.equal(citationResponse.status, 200);
assert.deepEqual(citationRequest.pages, [0]);
assert.deepEqual(Object.keys(citationRequest.document_annotation_format.json_schema.schema.properties), ['citation_mentions']);
assert.match(citationRequest.document_annotation_prompt, /narrative article prose/);

let referenceRequest;
const referenceBlocks = [{
  pageIndex: 7,
  pageId: 'ocr-page-7',
  blockIndex: 0,
  blockId: 'ocr-block-7-0',
  text: 'Smith A. Fixture study.'
}];
const referenceResponse = await referenceAnnotationPayload({ fileName: 'fixture.pdf', base64: pdf, referenceBlocks }, {
  env: { MISTRAL_API_KEY: 'test-key', MISTRAL_BASE_URL: 'https://example.test', MISTRAL_OCR_TIMEOUT_MS: '1000' },
  fetchImpl: async (_url, request) => {
    referenceRequest = JSON.parse(request.body);
    return new Response(JSON.stringify({
      document_annotation: {
        references: [{ id: 'ref-1', text: 'Smith A. Fixture study.', source: source(7, 0, 'Smith A. Fixture study.') }]
      }
    }), { status: 200 });
  }
});
assert.equal(referenceResponse.status, 200);
assert.deepEqual(referenceResponse.value.pages, [7]);
assert.equal(referenceResponse.value.references.length, 1);
assert.deepEqual(referenceRequest.pages, [7]);
assert.deepEqual(Object.keys(referenceRequest.document_annotation_format.json_schema.schema.properties), ['references']);
assert.match(referenceRequest.document_annotation_prompt, /AUTHORITATIVE RAW OCR REFERENCES BLOCKS/);
assert.match(referenceRequest.document_annotation_prompt, /Smith A\. Fixture study\./);

const linkCandidates = {
  displays: [{ handle: 'display-1', kind: 'table', label: 'Table 1', source: source(0, 0, 'Fixture') }],
  display_mentions: []
};
let sourceLinkRequest;
const sourceLinks = await displayLinksPayload({ candidates: linkCandidates }, {
  env: { MISTRAL_API_KEY: 'test-key', MISTRAL_DOCUMENT_QNA_SOURCE_LINKS_ENABLED: 'true', MISTRAL_BASE_URL: 'https://example.test', MISTRAL_SOURCE_LINKS_TIMEOUT_MS: '1000' },
  fetchImpl: async (_url, request) => {
    sourceLinkRequest = JSON.parse(request.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ display_mappings: [], unmatched_display_mentions: [], unmentioned_display_handles: ['display-1'] }) } }] }), { status: 200 });
  }
});
assert.equal(sourceLinks.status, 200);
assert.equal(sourceLinks.value.complete, true);
assert.equal(sourceLinkRequest.response_format.json_schema.name, 'deskreview_display_relation_mappings_v1');
assert.match(sourceLinkRequest.messages[0].content, /Validated display mention and candidate handles/);
assert.match(sourceLinkRequest.messages[0].content, /Every supplied candidate handle must occur exactly once/);
assert.doesNotMatch(sourceLinkRequest.messages[0].content, /reference/);
assert.doesNotMatch(sourceLinkRequest.messages[0].content, /data:application\/pdf;base64/);
assert.equal(sourceLinkRequest.reasoning_effort, undefined);
assert.equal(sourceLinkRequest.top_p, 1);
assert.equal(sourceLinkRequest.max_tokens, 16384);
const partialSourceLinks = await displayLinksPayload({ candidates: linkCandidates }, {
  env: { MISTRAL_API_KEY: 'test-key', MISTRAL_DOCUMENT_QNA_SOURCE_LINKS_ENABLED: 'true', MISTRAL_BASE_URL: 'https://example.test', MISTRAL_SOURCE_LINKS_TIMEOUT_MS: '1000' },
  fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ display_mappings: [{ mention_handle: 'missing-mention', display_handles: ['display-1'] }], unmatched_display_mentions: ['missing-mention'], unmentioned_display_handles: ['missing-display'] }) } }] }), { status: 200 })
});
assert.equal(partialSourceLinks.status, 502);
assert.equal((await displayLinksPayload({ pages: [], candidates: {} }, { env: { MISTRAL_API_KEY: 'test-key' } })).status, 409);

const referenceLinkCandidates = {
  references: [{ handle: 'ref-1', text: 'Smith A. Fixture study.' }],
  citation_mentions: [{ handle: 'cite-1', citation_text: '(Smith, 2024)', context_quote: 'Prior work (Smith, 2024).', source: source(0, 0, 'Prior work (Smith, 2024).') }]
};
let referenceLinkRequest;
const referenceLinks = await referenceLinksPayload({ candidates: referenceLinkCandidates }, {
  env: { MISTRAL_API_KEY: 'test-key', MISTRAL_DOCUMENT_QNA_SOURCE_LINKS_ENABLED: 'true', MISTRAL_BASE_URL: 'https://example.test', MISTRAL_REFERENCE_LINKS_TIMEOUT_MS: '1000' },
  fetchImpl: async (_url, request) => {
    referenceLinkRequest = JSON.parse(request.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ citation_mappings: [{ citation_handle: 'cite-1', reference_handles: ['ref-1'] }], unmatched_citation_handles: [] }) } }] }), { status: 200 });
  }
});
assert.equal(referenceLinks.status, 200);
assert.equal(referenceLinkRequest.response_format.json_schema.name, 'deskreview_reference_relation_mappings_v2');
assert.match(referenceLinkRequest.messages[0].content, /Validated reference and citation handles/);
assert.doesNotMatch(referenceLinkRequest.messages[0].content, /data:application\/pdf;base64/);

let time = 0;
const productionGuard = createRequestGuard({ env: { NODE_ENV: 'production', APP_ORIGIN: 'https://deskreview.ai', OCR_RATE_LIMIT_MAX: '1', OCR_RATE_LIMIT_WINDOW_MS: '60000' }, now: () => time });
const request = { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://deskreview.ai' }, socket: { remoteAddress: '127.0.0.1' } };
const lease = productionGuard.acquire(request);
assert.ok(lease.release);
lease.release();
assert.equal(productionGuard.acquire(request).rejected.status, 429);
assert.equal(createRequestGuard({ env: { NODE_ENV: 'production', APP_ORIGIN: 'https://deskreview.ai' } }).acquire({ ...request, headers: { 'content-type': 'application/json', origin: 'https://evil.example' } }).rejected.status, 403);
assert.equal(createRequestGuard({ env: { NODE_ENV: 'production', APP_ORIGIN: 'https://deskreview.ai' } }).acquire({ ...request, headers: { 'content-type': 'text/plain', origin: 'https://deskreview.ai' } }).rejected.status, 415);
const developmentGuard = createRequestGuard({ env: { NODE_ENV: 'development', OCR_RATE_LIMIT_MAX: '1', OCR_MAX_CONCURRENT: '2' } });
for (let index = 0; index < 3; index += 1) {
  const developmentLease = developmentGuard.acquire(request);
  assert.ok(developmentLease.release, 'Local multi-stage analysis is not blocked by the public per-minute abuse limit.');
  developmentLease.release();
}
console.log('server contract: ok');
