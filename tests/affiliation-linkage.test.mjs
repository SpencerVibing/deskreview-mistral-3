import assert from 'node:assert/strict';
import { projectAffiliationLinkage } from '../core/affiliation-linkage.js';

const map = projectAffiliationLinkage({
  authors: [{ text: 'Ada', affiliation_indexes: [0, 1] }, { text: 'Grace', affiliation_indexes: [1] }],
  affiliations: [{ text: 'Analytical Engine', author_indexes: [0] }, { text: 'Compiler Lab', author_indexes: [0, 1] }]
});
assert.equal(map.available, true);
assert.equal(map.authorLinked, 2);
assert.equal(map.affiliationLinked, 2);
assert.deepEqual(map.affiliations[1].linkedAuthors.map((author) => author.text), ['Ada', 'Grace']);
assert.equal(projectAffiliationLinkage({ authors: [{ text: 'Ada' }], affiliations: [] }).available, false);
console.log('affiliation linkage: ok');
