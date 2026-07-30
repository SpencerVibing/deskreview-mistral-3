import assert from 'node:assert/strict';
import { applySourceLinks, buildSourceLinkPacket, hasSourceLinkCandidates, projectAnnotationChunks, validSourceLinkPacket } from '../core/annotation-stages.js';
import { displayLinksFormat, hasValidDisplayLinks } from '../core/display-links-contract.js';
import { displayLinksContent } from '../services/mistral-display-links.js';

const source = (page, block, quote) => ({ ocr_page_id: `ocr-page-${page}`, ocr_block_id: `ocr-block-${page}-${block}`, exact_quote: quote });
const chunk = {
  front_matter: { titles: [], authors: [], affiliations: [], author_affiliation_links: [], keywords: [], abstracts: [] },
  body: {
    sections: [],
    prose_block_types: {},
    display_mentions: [{ id: 'm2', label: 'Table 1', item_exact_quote: 'Table 1', source: source(0, 0, 'See Table 1 for results.') }]
  },
  displays: { entries: [{ id: 't1', kind: 'table', label: 'Table 1', source: source(1, 1, 'Table 1 results') }] },
  bibliography: { entries: [
    { id: 'r1', text: 'Smith A. First study.', source: source(2, 0, 'Smith A. First study.') },
    { id: 'r2', text: 'Jones B. Second study.', source: source(2, 0, 'Quote unavailable in OCR.') }
  ] }
};
const pages = [
  {
    markdown: 'See Table 1 for results. Prior work (Smith, 2020) differs from later work (Jones, 2021). Waller et al. (2001) reported fewer violations.',
    blocks: [
      { content: 'See Table 1 for results.' },
      { content: 'Prior work (Smith, 2020) differs from later work (Jones, 2021). Waller et al. (2001) reported fewer violations.' }
    ]
  },
  { markdown: 'Table 1 results', blocks: [{ content: 'Other' }, { content: 'Table 1 results' }] },
  { markdown: 'Smith A. First study. Jones B. Second study.', blocks: [{ content: 'Smith A. First study. Jones B. Second study.' }] }
];

const staged = projectAnnotationChunks([chunk], { pages });
assert.deepEqual(Object.keys(staged.candidates), ['displays', 'display_mentions', 'citation_mentions']);
assert.equal(staged.candidates.citation_mentions.length, 0);
assert.equal(staged.annotation.references.references.length, 2, 'Bibliography entries remain countable when a source link is unavailable.');
assert.deepEqual(staged.annotation.references.references.map((entry) => entry.number), [1, 2]);
assert.equal(staged.annotation.references.references.some((entry) => Object.hasOwn(entry, 'body_occurrences')), false);
const packet = buildSourceLinkPacket(pages, staged.candidates);
assert.equal(packet.candidates.displays.length, 1);
assert.equal(packet.candidates.references, undefined);

const constrainedFormat = displayLinksFormat(staged.candidates).json_schema.schema;
assert.equal(constrainedFormat.properties.reference_mappings, undefined);
assert.deepEqual(constrainedFormat.properties.display_mappings.items.properties.mention_handle.enum, [staged.candidates.display_mentions[0].handle]);
assert.deepEqual(constrainedFormat.properties.display_mappings.items.properties.display_handles.items.enum, [staged.candidates.displays[0].handle]);
assert.equal(displayLinksFormat({ displays: staged.candidates.displays, display_mentions: [] }).json_schema.schema.properties.display_mappings.maxItems, 0);

const unanchoredCandidates = structuredClone(staged.candidates);
unanchoredCandidates.display_mentions[0].source.exact_quote = 'OCR did not return this phrase.';
assert.equal(hasSourceLinkCandidates(unanchoredCandidates), true);
assert.equal(validSourceLinkPacket(pages, unanchoredCandidates), false);

const links = { display_mappings: [{ mention_handle: staged.candidates.display_mentions[0].handle, display_handles: [staged.candidates.displays[0].handle] }], unmatched_display_mentions: [], unmentioned_display_handles: [] };
assert.equal(hasValidDisplayLinks(links, staged.candidates), true);
const projected = applySourceLinks(staged.annotation, staged.candidates, links);
assert.equal(projected.body.display_items[0].body_occurrences[0].citation_text, 'Table 1');
assert.equal(projected.body.display_items[0].body_occurrences[0].context_quote, 'See Table 1 for results.');
assert.equal(projected.references.references.length, 2);
assert.equal(hasValidDisplayLinks({ ...links, reference_mappings: [] }, staged.candidates), false);
assert.equal(hasValidDisplayLinks({ ...links, display_mappings: [] }, staged.candidates), false);
assert.throws(() => buildSourceLinkPacket([{ markdown: 'different', blocks: [{ content: 'different' }] }], staged.candidates), /not all backed/);
assert.deepEqual(
  displayLinksContent({ choices: [{ message: { content: [{ type: 'thinking', thinking: [] }, { type: 'text', text: JSON.stringify(links) }] } }] }),
  links
);
console.log('display links: ok');
