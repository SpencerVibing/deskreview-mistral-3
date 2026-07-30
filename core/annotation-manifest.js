import { annotationPageRanges } from './mistral-annotation-contract.js';

function rangeKey(pages = []) {
  return pages.join(',');
}

function assertRangeList(ranges = []) {
  const owners = new Map();
  ranges.forEach((pages, rangeIndex) => {
    if (!Array.isArray(pages) || !pages.length) throw new TypeError('Annotation manifest ranges must be non-empty page arrays.');
    pages.forEach((page) => {
      if (!Number.isInteger(page) || page < 0) throw new TypeError('Annotation manifest pages must be zero-based indexes.');
      if (owners.has(page)) throw new TypeError(`Annotation manifest page ${page} has more than one owner.`);
      owners.set(page, rangeIndex);
    });
  });
  const sorted = [...owners.keys()].sort((a, b) => a - b);
  sorted.forEach((page, index) => {
    if (page !== index) throw new TypeError(`Annotation manifest is missing owner for page ${index}.`);
  });
  return owners;
}

export function createAnnotationRunManifest(pageCount) {
  const ranges = annotationPageRanges(pageCount);
  const owners = assertRangeList(ranges);
  return {
    pageCount,
    ranges: ranges.map((pages, index) => ({
      id: `annotation-range-${index}`,
      pages,
      owned_pages: pages,
      context_pages: []
    })),
    page_owners: Object.fromEntries([...owners.entries()].map(([page, index]) => [page, `annotation-range-${index}`])),
    completed: [],
    failed: []
  };
}

export function markAnnotationRange(manifest = {}, pages = [], status = 'completed') {
  const key = rangeKey(pages);
  const range = (manifest.ranges || []).find((item) => rangeKey(item.pages) === key);
  if (!range) throw new TypeError('Annotation range is not part of the run manifest.');
  const next = {
    ...manifest,
    completed: [...(manifest.completed || [])],
    failed: [...(manifest.failed || [])]
  };
  next.completed = next.completed.filter((item) => item !== range.id);
  next.failed = next.failed.filter((item) => item !== range.id);
  if (status === 'completed') next.completed.push(range.id);
  else if (status === 'failed') next.failed.push(range.id);
  else throw new TypeError('Annotation range status must be completed or failed.');
  return next;
}

export function annotationManifestIsComplete(manifest = {}) {
  const ranges = manifest.ranges || [];
  const completed = new Set(manifest.completed || []);
  const failed = new Set(manifest.failed || []);
  return Boolean(ranges.length) && !failed.size && ranges.every((range) => completed.has(range.id));
}

export function annotationManifestHasFailures(manifest = {}) {
  return Boolean((manifest.failed || []).length);
}

export function annotationManifestSummary(manifest = {}) {
  const ranges = manifest.ranges || [];
  return {
    pageCount: manifest.pageCount || 0,
    rangeCount: ranges.length,
    completedCount: (manifest.completed || []).length,
    failedCount: (manifest.failed || []).length,
    complete: annotationManifestIsComplete(manifest)
  };
}
