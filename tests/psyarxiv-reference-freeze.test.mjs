import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  bindCitationAnnotationRanges,
  citationAnnotationContractVersion,
  citationAnnotationFormat,
  citationAnnotationPrompt
} from '../core/citation-annotation.js';
import {
  referenceAnnotationContractVersion,
  referenceAnnotationFormat,
  referenceAnnotationPrompt
} from '../core/reference-annotation.js';
import {
  applyReferenceLinks,
  hasValidReferenceLinks,
  referenceLinksFormat,
  referenceLinksPrompt
} from '../core/reference-links-contract.js';

const review = JSON.parse(await readFile(new URL('../public/data/stored/psyarxiv.json', import.meta.url), 'utf8'));
const references = review.annotations.references.references.map((item, index) => ({
  ...item,
  link_handle: `reference:${index}`
}));

assert.equal(review.raw.pages.length, 34, 'psyArXiv raw OCR page count changed');
assert.equal(references.length, 64, 'psyArXiv bibliography inventory must retain all 64 references');
assert.ok(
  review.annotations.body.sections.some((section) => section.heading === '5. Conclusion'),
  'psyArXiv article coverage must retain the Conclusion'
);

const contextQuote = 'Neurodevelopmental theories further support this perspective, proposing that adolescence and early adulthood are characterized by increased novelty- and sensation-seeking behaviors, without a parallel maturation of the self-regulatory capacities needed to manage these impulses effectively (Steinberg, 2008; 2010).';
const grounded = bindCitationAnnotationRanges([{
  range_id: 'citation-range-0',
  pages: [2],
  annotation: {
    citation_mentions: [{
      label: '(Steinberg, 2008; 2010)',
      context_quote: contextQuote
    }]
  }
}], review.raw.pages);

assert.equal(grounded.ranges[0].returned, 1);
assert.equal(grounded.ranges[0].accepted, 1, 'Known psyArXiv citation must remain source-grounded');
assert.equal(grounded.ranges[0].rejected, 0);
assert.equal(grounded.candidates[0].source.ocr_page_id, 'ocr-page-2');
assert.equal(grounded.candidates[0].source.ocr_block_id, 'ocr-block-2-3');

const candidates = {
  references: references.map((item) => ({ handle: item.link_handle, text: item.text })),
  citation_mentions: grounded.candidates
};
const links = {
  citation_mappings: [{
    citation_handle: grounded.candidates[0].handle,
    reference_handles: [references[52].link_handle, references[53].link_handle]
  }],
  unmatched_citation_handles: []
};

assert.equal(hasValidReferenceLinks(links, candidates), true, 'Known psyArXiv relation response must remain valid');
const linkedReferences = applyReferenceLinks(references, candidates, links);
assert.equal(linkedReferences.length, 64, 'Applying relations must never change the bibliography inventory');
assert.equal(linkedReferences[52].body_occurrences.length, 1);
assert.equal(linkedReferences[53].body_occurrences.length, 1);
assert.equal(linkedReferences[52].body_occurrences[0].context_quote, contextQuote);
assert.equal(linkedReferences[53].body_occurrences[0].source.ocr_block_id, 'ocr-block-2-3');

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const contractFixtureBlocks = [{
  pageIndex: 23,
  pageId: 'ocr-page-23',
  blockIndex: 0,
  blockId: 'ocr-block-23-0',
  text: 'Example bibliography entry.'
}];
const contractFixtureCandidates = {
  references: [{ handle: 'reference:0', text: 'Example bibliography entry.' }],
  citation_mentions: [{
    handle: 'citation:0',
    citation_text: '(Example, 2020)',
    context_quote: 'Prior work (Example, 2020).',
    source: {
      ocr_page_id: 'ocr-page-2',
      ocr_block_id: 'ocr-block-2-0',
      exact_quote: 'Prior work (Example, 2020).'
    }
  }]
};

assert.equal(citationAnnotationContractVersion, 'deskreview_body_citations_v1');
assert.equal(referenceAnnotationContractVersion, 'deskreview_reference_annotation_v1');
assert.equal(digest({
  version: citationAnnotationContractVersion,
  format: citationAnnotationFormat,
  prompt: citationAnnotationPrompt
}), '495f201b3978c79a123be00f81d8ea324bb3907e6540c4bdf06302c51e187dd4', 'Body-citation contract changed; update the version and acceptance evidence deliberately');
assert.equal(digest({
  version: referenceAnnotationContractVersion,
  format: referenceAnnotationFormat(contractFixtureBlocks),
  prompt: referenceAnnotationPrompt(contractFixtureBlocks)
}), '7058ce917b02481332eadcbdb7ff57fffe0bc69b15aa391b47ac23f5d8d83902', 'Bibliography contract changed; update the version and acceptance evidence deliberately');
assert.equal(digest({
  format: referenceLinksFormat(contractFixtureCandidates),
  prompt: referenceLinksPrompt
}), '6b3c2a811a89395bd2d612fce00376253463556230e3b8cf41d5923e3aa6c7df', 'Reference-relation contract changed; update the version and acceptance evidence deliberately');

console.log('psyArXiv reference freeze: ok');
