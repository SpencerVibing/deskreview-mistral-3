import assert from 'node:assert/strict';
import {
  annotationManifestHasFailures,
  annotationManifestIsComplete,
  annotationManifestSummary,
  createAnnotationRunManifest,
  markAnnotationRange
} from '../core/annotation-manifest.js';

assert.deepEqual(createAnnotationRunManifest(1).ranges.map((range) => range.pages), [[0]]);
assert.deepEqual(createAnnotationRunManifest(8).ranges.map((range) => range.pages), [[0, 1, 2, 3, 4, 5, 6, 7]]);
assert.deepEqual(createAnnotationRunManifest(17).ranges.map((range) => range.pages), [[0, 1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14, 15], [16]]);

const exactEight = markAnnotationRange(createAnnotationRunManifest(8), [0, 1, 2, 3, 4, 5, 6, 7], 'completed');
assert.equal(annotationManifestIsComplete(exactEight), true);
assert.deepEqual(annotationManifestSummary(exactEight), { pageCount: 8, rangeCount: 1, completedCount: 1, failedCount: 0, complete: true });

let multi = createAnnotationRunManifest(17);
multi = markAnnotationRange(multi, [0, 1, 2, 3, 4, 5, 6, 7], 'completed');
multi = markAnnotationRange(multi, [16], 'completed');
assert.equal(annotationManifestIsComplete(multi), false, 'A final partial range cannot finalize a missing middle range.');
multi = markAnnotationRange(multi, [8, 9, 10, 11, 12, 13, 14, 15], 'failed');
assert.equal(annotationManifestHasFailures(multi), true);
assert.equal(annotationManifestIsComplete(multi), false);
assert.deepEqual(annotationManifestSummary(multi), { pageCount: 17, rangeCount: 3, completedCount: 2, failedCount: 1, complete: false });

assert.throws(() => markAnnotationRange(createAnnotationRunManifest(9), [0, 1], 'completed'), /not part/);
assert.throws(() => markAnnotationRange(createAnnotationRunManifest(9), [0, 1, 2, 3, 4, 5, 6, 7], 'pending'), /completed or failed/);
assert.throws(() => createAnnotationRunManifest(0), /positive OCR page count/);

console.log('annotation manifest: ok');
