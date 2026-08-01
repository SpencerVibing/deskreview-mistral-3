import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  bindCitationAnnotationRanges,
  citationAnnotationContractVersion,
  citationAnnotationFormat,
  citationAnnotationIssues,
  citationAnnotationMentions,
  citationAnnotationPrompt
} from '../core/citation-annotation.js';
import {
  referenceAnnotationContractVersion,
  referenceAnnotationFormat,
  referenceAnnotationIssues,
  referenceAnnotationPrompt,
  referenceAnnotationReferences,
  referenceBlocksFromRawPages
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

const preprintReferenceCounts = {
  medrxiv: 22,
  chemrxiv: 63,
  eartharxiv: 47,
  researchsquare: 29,
  psyarxiv: 64
};
for (const [id, expectedCount] of Object.entries(preprintReferenceCounts)) {
  const fixture = JSON.parse(await readFile(new URL(`../public/data/stored/${id}.json`, import.meta.url), 'utf8'));
  assert.equal(
    fixture.annotations?.references?.references?.length,
    expectedCount,
    `${id}: frozen bibliography count changed`
  );
  assert.ok(
    referenceBlocksFromRawPages(fixture.raw?.pages || []).length > 0,
    `${id}: raw OCR bibliography block scope disappeared`
  );
}

const blockCoverageBlocks = [
  {
    pageIndex: 14,
    pageId: 'ocr-page-14',
    blockIndex: 2,
    blockId: 'ocr-block-14-2',
    text: 'Märcz A. First study. Second B. Volcano&hyphen;earthquake study.'
  },
  {
    pageIndex: 15,
    pageId: 'ocr-page-15',
    blockIndex: 0,
    blockId: 'ocr-block-15-0',
    text: 'Continuation of the second study.'
  }
];
const completeBlockResponse = {
  references: [
    { id: 'ref-1', printed_label: '', text: 'Märcz A. First study.' },
    { id: 'ref-2', printed_label: '', text: 'Second B. Volcano&hyphen;earthquake study. Continuation of the second study.' }
  ]
};
assert.deepEqual(referenceAnnotationIssues(completeBlockResponse, blockCoverageBlocks), []);
assert.equal(referenceAnnotationReferences(completeBlockResponse).length, 2);
assert.match(
  referenceAnnotationIssues({ references: completeBlockResponse.references.slice(0, 1) }, blockCoverageBlocks).join(' '),
  /covers only/,
  'Grossly incomplete text must fail the flat inventory contract'
);
assert.match(
  referenceAnnotationIssues({
    references: [{ id: 'ref-1', printed_label: '', text: '' }, completeBlockResponse.references[1]]
  }, blockCoverageBlocks).join(' '),
  /no text/,
  'A reference without complete text must remain visible as a contract failure'
);

const contextQuote = 'Neurodevelopmental theories further support this perspective, proposing that adolescence and early adulthood are characterized by increased novelty- and sensation-seeking behaviors, without a parallel maturation of the self-regulatory capacities needed to manage these impulses effectively (Steinberg, 2008; 2010).';
const psyCitationBlock = {
  pageIndex: 2,
  pageId: 'ocr-page-2',
  blockIndex: 3,
  blockId: 'ocr-block-2-3',
  text: review.raw.pages[2].blocks[3].content
};
const psyCitationResponse = {
  citation_blocks: [{
    ocr_page_id: psyCitationBlock.pageId,
    ocr_block_id: psyCitationBlock.blockId,
    citation_mentions: [{
      citation_text: '(Steinberg, 2008; 2010)'
    }]
  }]
};
assert.deepEqual(citationAnnotationIssues(psyCitationResponse, [psyCitationBlock]), []);
const grounded = bindCitationAnnotationRanges([{
  range_id: 'citation-range-0',
  pages: [2],
  supplied_blocks: [psyCitationBlock],
  citation_blocks: psyCitationResponse.citation_blocks,
  citation_mentions: citationAnnotationMentions(psyCitationResponse, [psyCitationBlock])
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
  citation_decisions: [{
    citation_handle: grounded.candidates[0].handle,
    classification: 'bibliographic_citation',
    reference_handles: [references[52].link_handle, references[53].link_handle]
  }]
};

assert.equal(hasValidReferenceLinks(links, candidates), true, 'Known psyArXiv relation response must remain valid');
const linkedReferences = applyReferenceLinks(references, candidates, links);
assert.equal(linkedReferences.length, 64, 'Applying relations must never change the bibliography inventory');
assert.equal(linkedReferences[52].body_occurrences.length, 1);
assert.equal(linkedReferences[53].body_occurrences.length, 1);
assert.equal(linkedReferences[52].body_occurrences[0].context_quote, psyCitationBlock.text);
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
const citationContractFixtureBlocks = [{
  pageIndex: 2,
  pageId: 'ocr-page-2',
  blockIndex: 0,
  blockId: 'ocr-block-2-0',
  text: 'Prior work (Example, 2020) established this result.'
}];
const contractFixtureCandidates = {
  references: [{ handle: 'reference:0', printed_label: '', text: 'Example bibliography entry.' }],
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

const medrxiv = JSON.parse(await readFile(new URL('../public/data/stored/medrxiv.json', import.meta.url), 'utf8'));
const medCitationBlock = {
  pageIndex: 4,
  pageId: 'ocr-page-4',
  blockIndex: 2,
  blockId: 'ocr-block-4-2',
  text: medrxiv.raw.pages[4].blocks[2].content
};
const medCitationResponse = {
  citation_blocks: [{
    ocr_page_id: medCitationBlock.pageId,
    ocr_block_id: medCitationBlock.blockId,
    citation_mentions: [
      { citation_text: '¹' },
      { citation_text: '²' },
      { citation_text: '³' }
    ]
  }]
};
assert.deepEqual(citationAnnotationIssues(medCitationResponse, [medCitationBlock]), [], 'medRxiv superscript citations must remain source-grounded');
const ungroundedMedCitation = structuredClone(medCitationResponse);
ungroundedMedCitation.citation_blocks[0].citation_mentions[0].citation_text = '99';
assert.match(
  citationAnnotationIssues(ungroundedMedCitation, [medCitationBlock]).join(' '),
  /not present or uniquely alignable in its declared OCR block/,
  'Citation text outside its declared block must fail visibly'
);
const medBoundaryBlocks = [{
  pageIndex: 12,
  pageId: 'ocr-page-12',
  blockIndex: 8,
  blockId: 'ocr-block-12-8',
  text: medrxiv.raw.pages[12].blocks[8].content
}, {
  pageIndex: 13,
  pageId: 'ocr-page-13',
  blockIndex: 1,
  blockId: 'ocr-block-13-1',
  text: medrxiv.raw.pages[13].blocks[1].content
}];
const wrongBoundaryResponse = {
  citation_blocks: [{
    ocr_page_id: 'ocr-page-12',
    ocr_block_id: 'ocr-block-12-8',
    citation_mentions: [{ citation_text: '²²' }]
  }, {
    ocr_page_id: 'ocr-page-13',
    ocr_block_id: 'ocr-block-13-1',
    citation_mentions: []
  }]
};
// A visually continuous sentence can cross a PDF page and OCR block. The
// anchor must belong wholly to the block containing the printed citation.
assert.match(
  citationAnnotationIssues(wrongBoundaryResponse, medBoundaryBlocks).join(' '),
  /not present or uniquely alignable in its declared OCR block/,
  'A cross-page citation must not be assigned to the block preceding its printed citation label'
);
const correctBoundaryResponse = {
  citation_blocks: [{
    ocr_page_id: 'ocr-page-12',
    ocr_block_id: 'ocr-block-12-8',
    citation_mentions: []
  }, {
    ocr_page_id: 'ocr-page-13',
    ocr_block_id: 'ocr-block-13-1',
    citation_mentions: [{ citation_text: '²²' }]
  }]
};
assert.deepEqual(
  citationAnnotationIssues(correctBoundaryResponse, medBoundaryBlocks),
  [],
  'A cross-page sentence is grounded by the within-block fragment that owns its citation label'
);

assert.equal(citationAnnotationContractVersion, 'deskreview_body_citations_v10');
assert.equal(referenceAnnotationContractVersion, 'deskreview_reference_annotation_v7');
assert.equal(digest({
  version: citationAnnotationContractVersion,
  format: citationAnnotationFormat(citationContractFixtureBlocks),
  prompt: citationAnnotationPrompt(citationContractFixtureBlocks)
}), '69032ef3ecadff5c8ea71a942de8148e34a2d0d553ac03daefebb0ec40a6be26', 'Body-citation contract changed; update the version and acceptance evidence deliberately');
assert.equal(digest({
  version: referenceAnnotationContractVersion,
  format: referenceAnnotationFormat(contractFixtureBlocks),
  prompt: referenceAnnotationPrompt(contractFixtureBlocks)
}), 'dacac9c108f73a43afcf8e99da8c1137f968069dc881ee5161197fe96b0ca29e', 'Bibliography contract changed; update the version and acceptance evidence deliberately');
assert.equal(digest({
  format: referenceLinksFormat(contractFixtureCandidates),
  prompt: referenceLinksPrompt
}), '7397b126286eda7bcd7f588ac65bdd7889ed38a31502c789be835f05d2bbc0d7', 'Reference-relation contract changed; update the version and acceptance evidence deliberately');

console.log('preprint reference freeze: ok');
