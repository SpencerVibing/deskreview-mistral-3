import assert from 'node:assert/strict';
import { createRuntimeLog } from '../public/app/runtime-log.js';

let time = 100;
const runtime = createRuntimeLog(() => time);
time = 350;
runtime.record('OCR ready', 'One page returned.');
time = 500;
runtime.record('OCR ready', 'Duplicate event is ignored.');
assert.deepEqual(runtime.entries(), [{ label: 'OCR ready', detail: 'One page returned.', elapsedMs: 250 }]);
runtime.reset();
time = 640;
runtime.record('Annotation ready');
assert.deepEqual(runtime.entries(), [{ label: 'Annotation ready', detail: '', elapsedMs: 140 }]);
console.log('runtime log: ok');

