import assert from 'node:assert/strict';
import { createRuntimeLog, runtimeFlowModel } from '../public/app/runtime-log.js';

let time = 100;
const runtime = createRuntimeLog(() => time);
time = 350;
runtime.record('OCR ready', 'One page returned.');
time = 500;
runtime.record('OCR ready', 'Duplicate event is ignored.');
assert.deepEqual(runtime.entries(), [{ key: 'OCR ready', label: 'OCR ready', detail: 'One page returned.', elapsedMs: 250 }]);
runtime.reset();
time = 640;
runtime.record('Annotation ready');
assert.deepEqual(runtime.entries(), [{ key: 'Annotation ready', label: 'Annotation ready', detail: '', elapsedMs: 140 }]);
runtime.restore([{ key: 'ocr', label: 'OCR ready', detail: '2.1 seconds', elapsedMs: 2100 }]);
runtime.record('OCR ready', 'new value', 'ocr');
assert.deepEqual(runtime.entries(), [{ key: 'ocr', label: 'OCR ready', detail: '2.1 seconds', elapsedMs: 2100 }]);
runtime.restore([{ label: 'Legacy OCR ready', detail: 'Original stored summary without timing.' }]);
assert.deepEqual(runtime.entries(), [{ key: 'Legacy OCR ready', label: 'Legacy OCR ready', detail: 'Original stored summary without timing.', elapsedMs: 0 }]);

const flow = runtimeFlowModel([
  { key: 'Upload started', label: 'Upload started', detail: 'fixture.pdf', elapsedMs: 0 },
  { key: 'raw-ocr', label: 'OCR ready', detail: '12 pages returned.', elapsedMs: 2800 },
  { key: 'toc', label: 'Table of contents ready', detail: '8 headings returned.', elapsedMs: 2900 },
  { key: 'annotation:0', label: 'Annotation pages ready', detail: 'Pages 1-8 returned.', elapsedMs: 8400 },
  { key: 'count:authors', label: 'Authors count ready', detail: '4 authors returned.', elapsedMs: 8500 },
  { key: 'links:authors', label: 'Authors source links ready', detail: '4/4 links confirmed.', elapsedMs: 8600 },
  { key: 'author-profiles:start', label: 'Author profile lookup started', detail: '', elapsedMs: 8700 },
  { key: 'author-profiles:ready', label: 'Author profile lookup ready', detail: '3/4 found.', elapsedMs: 9400 },
  { key: 'count:references', label: 'References count ready', detail: '64 references returned.', elapsedMs: 12100 },
  { key: 'body-citations:unavailable', label: 'Body citation extraction unavailable', detail: '0 returned; 0 grounded; 0 rejected.', elapsedMs: 12150 },
  { key: 'reference-links:start', label: 'Reference links started', detail: '0 source-grounded body citation groups are being matched to 64 references.', elapsedMs: 12200 },
  { key: 'reference-links:unavailable', label: 'Reference links unavailable', detail: '', elapsedMs: 15100 },
  { key: 'storage', label: 'Review stored locally', detail: '', elapsedMs: 15200 }
]);
assert.equal(flow.elapsedMs, 15200);
assert.equal(flow.countsReady, 2);
assert.equal(flow.linksReady, 1);
assert.equal(flow.stages.find((item) => item.id === 'ocr').state, 'ready');
assert.equal(flow.results.find((item) => item.kind === 'authors').extra.state, 'ready');
assert.equal(flow.results.find((item) => item.kind === 'references').extra.state, 'unavailable');
assert.equal(flow.results.find((item) => item.kind === 'references').count.state, 'ready');
assert.equal(flow.results.find((item) => item.kind === 'references').links.state, 'unavailable');
assert.equal(flow.results.find((item) => item.kind === 'references').dependencies[1].state, 'unavailable');
assert.match(flow.results.find((item) => item.kind === 'references').dependencies[1].detail, /0 grounded/);

const failedInventoryFlow = runtimeFlowModel([
  { key: 'reference-inventory:start', label: 'Reference inventory started', detail: '20 OCR reference blocks sent.', elapsedMs: 1200 },
  { key: 'reference-inventory:unavailable', label: 'Reference inventory unavailable', detail: 'Mistral reference annotation timed out.', elapsedMs: 62300 }
]);
assert.equal(failedInventoryFlow.results.find((item) => item.kind === 'references').dependencies[0].state, 'unavailable');
assert.match(failedInventoryFlow.results.find((item) => item.kind === 'references').dependencies[0].detail, /timed out/);
console.log('runtime log: ok');
