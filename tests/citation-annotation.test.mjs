import assert from 'node:assert/strict';
import {
  bindCitationAnnotationRanges,
  bodyCitationPageRanges,
  citationAnnotationContractVersion,
  validCitationAnnotation
} from '../core/citation-annotation.js';

const chunk = (pages) => ({
  annotation: {
    body: {
      prose_block_types: Object.fromEntries(pages.map((page) => [`ocr-block-${page}-0 :: Article prose ${page}`, 'article']))
    }
  }
});

assert.equal(citationAnnotationContractVersion, 'deskreview_body_citations_v1');
assert.deepEqual(bodyCitationPageRanges([chunk([0, 1, 2, 3, 4, 5, 6, 7]), chunk([8, 9, 11])]), [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [8, 9],
  [11]
]);
assert.equal(validCitationAnnotation({ citation_mentions: [{ label: '(Smith, 2024)', context_quote: 'Prior work (Smith, 2024) found this.' }] }), true);
assert.equal(validCitationAnnotation({ citation_mentions: [{ label: '(Smith, 2024)', context_quote: '' }] }), false);

const pages = [{
  markdown: 'Prior work (Smith, 2024) found this. Another statement.',
  blocks: [{ type: 'text', content: 'Prior work (Smith, 2024) found this. Another statement.' }]
}];
const grounded = bindCitationAnnotationRanges([{
  range_id: 'citation-range-0',
  pages: [0],
  annotation: {
    citation_mentions: [
      { label: '(Smith, 2024)', context_quote: 'Prior work (Smith, 2024) found this.' },
      { label: '(Jones, 2022)', context_quote: 'Prior work (Smith, 2024) found this.' }
    ]
  }
}], pages);
assert.equal(grounded.ranges[0].returned, 2);
assert.equal(grounded.ranges[0].accepted, 1);
assert.equal(grounded.ranges[0].rejected, 1);
assert.deepEqual(grounded.ranges[0].reasonCounts, { label_not_in_context: 1 });
assert.equal(grounded.candidates.length, 1);
assert.equal(grounded.candidates[0].source.ocr_block_id, 'ocr-block-0-0');

console.log('citation annotation: ok');
