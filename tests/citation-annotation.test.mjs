import assert from 'node:assert/strict';
import {
  alignCitationSourceSpan,
  bindCitationAnnotationRanges,
  bodyCitationBlockRanges,
  citationAnnotationContractVersion,
  citationAnnotationFormat,
  citationAnnotationIssues,
  citationAnnotationMentions,
  citationAnnotationPrompt,
  citationBlocksFromAnnotation,
  MAX_CITATION_BLOCKS_PER_REQUEST,
  MAX_CITATION_REQUESTS_PER_MANUSCRIPT,
  validCitationAnnotation
} from '../core/citation-annotation.js';

const rawPages = Array.from({ length: 12 }, (_, pageIndex) => ({
  blocks: [{ type: 'text', content: `Article prose ${pageIndex} cites Smith¹.` }]
}));
const chunk = (pages) => ({
  annotation: {
    body: {
      prose_block_types: Object.fromEntries(pages.map((page) => [`ocr-block-${page}-0 :: Article prose ${page}`, 'article']))
    }
  }
});
const chunks = [chunk([0, 1, 2, 3, 4, 5, 6, 7]), chunk([8, 9, 11])];
const selectedBlocks = citationBlocksFromAnnotation(chunks, rawPages);
assert.equal(selectedBlocks.length, 11);
assert.deepEqual(bodyCitationBlockRanges(chunks, rawPages).map((range) => range.pages), [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [8, 9],
  [11]
]);

const denseRawPages = Array.from({ length: 4 }, (_, pageIndex) => ({
  blocks: Array.from({ length: 6 }, (_, blockIndex) => ({ type: 'text', content: `Dense article ${pageIndex}-${blockIndex}.` }))
}));
const denseChunk = {
  annotation: {
    body: {
      prose_block_types: Object.fromEntries(denseRawPages.flatMap((page, pageIndex) => page.blocks.map((block, blockIndex) => (
        [`ocr-block-${pageIndex}-${blockIndex} :: ${block.content}`, 'article']
      ))))
    }
  }
};
const denseRanges = bodyCitationBlockRanges([denseChunk], denseRawPages);
assert.deepEqual(denseRanges.map((range) => range.pages), [[0], [1], [2], [3]], 'Dense packets split only at page boundaries');
assert.ok(denseRanges.every((range) => range.blocks.length <= MAX_CITATION_BLOCKS_PER_REQUEST));
assert.equal(MAX_CITATION_BLOCKS_PER_REQUEST, 8);
assert.equal(new Set(denseRanges.flatMap((range) => range.pages)).size, 4, 'Bounded ranges never overlap pages');
assert.equal(MAX_CITATION_REQUESTS_PER_MANUSCRIPT, 12);

assert.deepEqual(
  alignCitationSourceSpan('(Waller et al., 2001)', 'Consistent with this view, Waller et al. (2001), found that...'),
  { exact_quote: 'Waller et al. (2001)', method: 'aligned' }
);
assert.deepEqual(
  alignCitationSourceSpan(
    '(Megías-Robles et al., 2022) and (Megías et al., 2018)',
    'Following the procedure used by Megías-Robles et al. (2022) and Megías et al. (2018), annual mileage was assessed.'
  ),
  { exact_quote: 'Megías-Robles et al. (2022) and Megías et al. (2018)', method: 'aligned' }
);
assert.equal(
  alignCitationSourceSpan(
    '(Dula & Ballard, 2003)',
    'Behavior was measured (Dula & Ballard, 2003; Sánchez-López et al., 2024; Willemsen et al., 2008).'
  ),
  null,
  'Alignment never carves one returned citation out of a larger source group'
);
assert.equal(
  alignCitationSourceSpan('(Hayes, 2022)', 'Regression assumptions and bootstrapping were evaluated.'),
  null,
  'Alignment never searches outside the declared block'
);
assert.equal(
  alignCitationSourceSpan('(Waller et al., 2001)', 'Waller et al. (2001) confirmed this; Waller et al. (2001) also replicated it.'),
  null,
  'Ambiguous within-block matches fail closed'
);
assert.equal(
  alignCitationSourceSpan('(Sanchez-Lopez et al., 2024)', 'Prior work by Sánchez-López et al., 2024 supports this.'),
  null,
  'Diacritics remain source-significant'
);

assert.equal(citationAnnotationContractVersion, 'deskreview_body_citations_v10');
const blocks = selectedBlocks.slice(0, 2);
const format = citationAnnotationFormat(blocks);
assert.deepEqual(Object.keys(format.json_schema.schema.properties), ['citation_blocks']);
assert.equal(format.json_schema.schema.properties.citation_blocks.minItems, 2);
assert.deepEqual(
  Object.keys(format.json_schema.schema.properties.citation_blocks.items.properties.citation_mentions.items.properties),
  ['citation_text']
);
assert.deepEqual(
  format.json_schema.schema.properties.citation_blocks.items.properties.ocr_block_id.enum,
  ['ocr-block-0-0', 'ocr-block-1-0']
);
assert.match(citationAnnotationPrompt(blocks), /AUTHORITATIVE RAW OCR ARTICLE BLOCKS/);
assert.match(citationAnnotationPrompt(blocks), /sole authoritative transcription source/);
assert.match(citationAnnotationPrompt(blocks), /Return each physical occurrence exactly once/);
assert.match(citationAnnotationPrompt(blocks), /Never assign an occurrence to the preceding or following block/);
assert.match(citationAnnotationPrompt(blocks), /grant or project numbers/);
assert.match(citationAnnotationPrompt(blocks), /literal substring of its declared raw OCR block/);

const response = {
  citation_blocks: [
    {
      ocr_page_id: 'ocr-page-0',
      ocr_block_id: 'ocr-block-0-0',
      citation_mentions: [{ citation_text: '¹' }]
    },
    {
      ocr_page_id: 'ocr-page-1',
      ocr_block_id: 'ocr-block-1-0',
      citation_mentions: [{ citation_text: '¹' }]
    }
  ]
};
assert.deepEqual(citationAnnotationIssues(response, blocks), []);
assert.equal(validCitationAnnotation(response, blocks), true);
const mentions = citationAnnotationMentions(response, blocks);
assert.equal(mentions.length, 2, 'Repeated labels remain separate occurrences');
assert.equal(mentions[0].source.ocr_block_id, 'ocr-block-0-0');
assert.equal(mentions[0].label, '¹');
assert.equal(mentions[0].context_quote, 'Article prose 0 cites Smith¹.');
assert.equal(mentions[0].source.exact_quote, '¹');

const ungroundedCitation = structuredClone(response);
ungroundedCitation.citation_blocks[0].citation_mentions[0].citation_text = '1';
assert.match(citationAnnotationIssues(ungroundedCitation, blocks).join(' '), /not present or uniquely alignable in its declared OCR block/);
const duplicateCitation = structuredClone(response);
duplicateCitation.citation_blocks[0].citation_mentions.push({ citation_text: '¹' });
assert.match(citationAnnotationIssues(duplicateCitation, blocks).join(' '), /returned more often than its exact text occurs/);
const duplicateGrounding = bindCitationAnnotationRanges([{
  range_id: 'citation-range-duplicate',
  pages: [0, 1],
  citation_mentions: citationAnnotationMentions(duplicateCitation, blocks)
}], rawPages);
assert.equal(duplicateGrounding.ranges[0].accepted, 2);
assert.equal(duplicateGrounding.ranges[0].rejected, 1);
assert.deepEqual(duplicateGrounding.ranges[0].reasonCounts, { citation_occurrence_exceeds_source: 1 });
assert.equal(duplicateGrounding.candidates[0].source.exact_quote, '¹', 'HTML navigation retains only the exact citation marker');
assert.equal(duplicateGrounding.candidates[0].context_quote, 'Article prose 0 cites Smith¹.', 'The complete immutable OCR block remains display context');
assert.match(citationAnnotationIssues({ citation_blocks: response.citation_blocks.slice(0, 1) }, blocks).join(' '), /missing/);
assert.match(citationAnnotationIssues({ citation_blocks: [response.citation_blocks[0], response.citation_blocks[0]] }, blocks).join(' '), /more than once.*missing/);

const alignedBlocks = [{
  pageIndex: 0,
  pageId: 'ocr-page-0',
  blockIndex: 0,
  blockId: 'ocr-block-0-0',
  text: 'Consistent with this view, Waller et al. (2001), found that...'
}];
const alignedResponse = {
  citation_blocks: [{
    ocr_page_id: 'ocr-page-0',
    ocr_block_id: 'ocr-block-0-0',
    citation_mentions: [{ citation_text: '(Waller et al., 2001)' }]
  }]
};
assert.deepEqual(citationAnnotationIssues(alignedResponse, alignedBlocks), []);
const alignedMention = citationAnnotationMentions(alignedResponse, alignedBlocks)[0];
assert.equal(alignedMention.label, '(Waller et al., 2001)', 'Relation input preserves the model-authored citation');
assert.equal(alignedMention.source.exact_quote, 'Waller et al. (2001)', 'HTML anchor uses literal OCR text');
assert.equal(alignedMention.source_alignment, 'aligned');
const alignedGrounding = bindCitationAnnotationRanges([{
  range_id: 'citation-range-aligned',
  pages: [0],
  citation_mentions: [alignedMention]
}], [{ blocks: [{ type: 'text', content: alignedBlocks[0].text }] }]);
assert.equal(alignedGrounding.ranges[0].items[0].sourceAlignment, 'aligned');
assert.equal(alignedGrounding.candidates[0].source_alignment, 'aligned');

const duplicateRawPages = [{
  blocks: [{ type: 'text', content: 'Prior work (Smith, 2024) found this.' }]
}, {
  blocks: [{ type: 'text', content: 'Prior work (Smith, 2024) found this.' }]
}];
const grounded = bindCitationAnnotationRanges([{
  range_id: 'citation-range-0',
  pages: [0, 1],
  supplied_blocks: [
    { pageIndex: 0, pageId: 'ocr-page-0', blockIndex: 0, blockId: 'ocr-block-0-0', text: duplicateRawPages[0].blocks[0].content },
    { pageIndex: 1, pageId: 'ocr-page-1', blockIndex: 0, blockId: 'ocr-block-1-0', text: duplicateRawPages[1].blocks[0].content }
  ],
  citation_blocks: response.citation_blocks,
  citation_mentions: [{
    label: '(Smith, 2024)',
    context_quote: 'Prior work (Smith, 2024) found this.',
    source: { ocr_page_id: 'ocr-page-0', ocr_block_id: 'ocr-block-0-0', exact_quote: 'Prior work (Smith, 2024) found this.' }
  }, {
    label: '(Smith, 2024)',
    context_quote: 'Prior work (Smith, 2024) found this.',
    source: { ocr_page_id: 'ocr-page-1', ocr_block_id: 'ocr-block-1-0', exact_quote: 'Prior work (Smith, 2024) found this.' }
  }]
}], duplicateRawPages);
assert.equal(grounded.ranges[0].returned, 2);
assert.equal(grounded.ranges[0].accepted, 2, 'Declared block IDs allow repeated exact context across pages');
assert.equal(grounded.ranges[0].rejected, 0);
assert.equal(grounded.candidates.length, 2);

console.log('citation annotation: ok');
