import assert from 'node:assert/strict';
import { applyReferenceLinks, hasReferenceLinkCandidates, hasValidReferenceLinks, referenceLinksFormat } from '../core/reference-links-contract.js';

const source = { ocr_page_id: 'ocr-page-2', ocr_block_id: 'ocr-block-2-3', exact_quote: 'Prior work supports this finding [1].' };
const candidates = {
  references: [
    { handle: 'ref-1', text: 'Example reference.' },
    { handle: 'ref-2', text: 'Unmentioned reference.' }
  ],
  citation_mentions: [
    { handle: 'cite-1', citation_text: '[1]', context_quote: source.exact_quote, source }
  ]
};
const links = {
  citation_mappings: [{ citation_handle: 'cite-1', reference_handles: ['ref-1'] }],
  unmatched_citation_handles: []
};

assert.equal(hasReferenceLinkCandidates(candidates), true);
assert.equal(referenceLinksFormat(candidates).json_schema.name, 'deskreview_reference_relation_mappings_v2');
assert.deepEqual(referenceLinksFormat(candidates).json_schema.schema.properties.citation_mappings.items.properties.citation_handle.enum, ['cite-1']);
assert.equal(JSON.stringify(referenceLinksFormat(candidates)).includes('"uniqueItems"'), false);
assert.equal(Object.hasOwn(referenceLinksFormat(candidates).json_schema.schema.properties, 'unmentioned_reference_handles'), false);
assert.equal(hasValidReferenceLinks(links, candidates), true);
assert.equal(hasValidReferenceLinks({ ...links, unmatched_citation_handles: ['cite-1'] }, candidates), false);
assert.equal(hasValidReferenceLinks({ ...links, unmentioned_reference_handles: ['ref-2'] }, candidates), false);
const applied = applyReferenceLinks([
  { link_handle: 'ref-1', text: 'Example reference.' },
  { link_handle: 'ref-2', text: 'Unmentioned reference.' }
], candidates, links);
assert.equal(applied[0].body_occurrences.length, 1);
assert.equal(applied[0].body_occurrences[0].context_quote, source.exact_quote);
assert.equal(applied[1].body_occurrences.length, 0);
console.log('reference links: ok');
