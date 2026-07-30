import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateDeclaredSource } from '../core/source-anchor.js';

const fixtures = {
  medrxiv: {
    pages: 24,
    counts: { authors: 23, affiliations: 11, keywords: 0, references: 22, tables: 3, figures: 1 },
    requiredSections: ['Conclusions'],
    anchorMinimums: { authors: 23, references: 0, displays: 0 }
  },
  chemrxiv: {
    pages: 32,
    counts: { authors: 5, affiliations: 6, keywords: 3, references: 63, tables: 1, figures: 4 },
    requiredSections: ['Outlook', 'Soy Protein Analysis', 'Phosphorus Recirculation Analysis'],
    anchorMinimums: { authors: 5, affiliations: 6, keywords: 3, references: 63, displays: 5 }
  },
  eartharxiv: {
    pages: 19,
    counts: { authors: 3, affiliations: 3, keywords: 3, references: 47, tables: 0, figures: 3 },
    requiredSections: ['2.3.1 Radon transport'],
    anchorMinimums: { authors: 0, references: 0, displays: 0 }
  },
  researchsquare: {
    pages: 13,
    counts: { authors: 8, affiliations: 1, keywords: 5, references: 29, tables: 3, figures: 3 },
    requiredSections: ['DISCUSSION'],
    anchorMinimums: { authors: 8, affiliations: 1, keywords: 5, references: 29, displays: 6 }
  },
  psyarxiv: {
    pages: 34,
    counts: { authors: 2, affiliations: 1, keywords: 6, references: 64, tables: 6, figures: 1 },
    requiredSections: ['4. Discussion', '5. Conclusion'],
    anchorMinimums: { authors: 2, affiliations: 1, keywords: 6, references: 64, displays: 7 }
  }
};

function front(annotation = {}) {
  return annotation['front-matter'] || annotation.front_matter || {};
}

function body(annotation = {}) {
  return annotation.body || {};
}

function references(annotation = {}) {
  return annotation.references || {};
}

function displayItems(annotation = {}) {
  return body(annotation).display_items || [];
}

function countsFor(annotation = {}) {
  const displays = displayItems(annotation);
  return {
    authors: (front(annotation).authors || []).length,
    affiliations: (front(annotation).affiliations || []).length,
    keywords: (front(annotation).keywords || []).length,
    references: (references(annotation).references || []).length,
    tables: displays.filter((item) => item.kind === 'table').length,
    figures: displays.filter((item) => item.kind === 'figure').length
  };
}

function sourceValid(pages = [], item = {}) {
  return validateDeclaredSource(pages, { source: item.source });
}

function anchorCounts(review = {}) {
  const annotation = review.annotations || {};
  const pages = review.raw?.pages || [];
  const groups = {
    authors: front(annotation).authors || [],
    affiliations: front(annotation).affiliations || [],
    keywords: front(annotation).keywords || [],
    sections: body(annotation).sections || [],
    references: references(annotation).references || [],
    displays: displayItems(annotation)
  };
  return Object.fromEntries(Object.entries(groups).map(([kind, items]) => [kind, {
    valid: items.filter((item) => sourceValid(pages, item)).length,
    total: items.length
  }]));
}

function occurrenceCount(items = []) {
  return items.reduce((total, item) => total + (Array.isArray(item.body_occurrences) ? item.body_occurrences.length : 0), 0);
}

async function readReview(id) {
  return JSON.parse(await readFile(new URL(`../public/data/stored/${id}.json`, import.meta.url), 'utf8'));
}

for (const [id, expected] of Object.entries(fixtures)) {
  const review = await readReview(id);
  assert.equal(review.raw?.pages?.length, expected.pages, `${id}: raw OCR page count changed`);
  assert.deepEqual(countsFor(review.annotations), expected.counts, `${id}: cached count baseline changed`);

  const headings = (body(review.annotations).sections || []).map((section) => section.heading);
  for (const heading of expected.requiredSections) {
    assert.ok(headings.includes(heading), `${id}: required late section missing: ${heading}`);
  }

  const anchors = anchorCounts(review);
  for (const [kind, minimum] of Object.entries(expected.anchorMinimums)) {
    assert.ok(anchors[kind].valid >= minimum, `${id}: ${kind} valid source anchors regressed below ${minimum} (${anchors[kind].valid}/${anchors[kind].total})`);
  }

  const refs = references(review.annotations).references || [];
  const displays = displayItems(review.annotations);
  assert.equal(occurrenceCount(refs), 0, `${id}: relation-link baseline changed; update acceptance criteria with cached source-link evidence`);
  assert.equal(occurrenceCount(displays), 0, `${id}: display-link baseline changed; update acceptance criteria with cached source-link evidence`);
  assert.equal(Boolean(review.sourceLinks), false, `${id}: sourceLinks payload appeared without a Step 10 acceptance update`);
}

console.log('gold fixture acceptance: ok');
