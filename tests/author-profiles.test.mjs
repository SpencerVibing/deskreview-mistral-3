import assert from 'node:assert/strict';
import { authorLookupName, mapOpenAlexProfile, normalizeAuthorName, normalizeOrcid } from '../core/author-profiles.js';
import { lookupAuthorProfiles } from '../server/author-profile-service.js';

assert.equal(normalizeAuthorName('María L. Example, PhD'), 'maria l example');
assert.equal(authorLookupName('**Fabiane Raquel Motter** ( fabiane.motter@hsl.org.br )'), 'Fabiane Raquel Motter');
assert.equal(normalizeOrcid('https://orcid.org/0000-0001-2345-6789'), '0000-0001-2345-6789');

const matched = mapOpenAlexProfile(
  { text: 'María L. Example, PhD', orcid: '' },
  [{ id: 'https://openalex.org/A123', display_name: 'Maria L Example', orcid: 'https://orcid.org/0000-0001-2345-6789', works_count: 6, cited_by_count: 31 }]
);
assert.deepEqual(matched, {
  name: 'María L. Example, PhD',
  status: 'found',
  openAlexUrl: 'https://openalex.org/A123',
  orcidUrl: 'https://orcid.org/0000-0001-2345-6789',
  worksCount: 6,
  citedByCount: 31
});

const uncertain = mapOpenAlexProfile(
  { text: 'Alex Example' },
  [{ id: 'https://openalex.org/A1', display_name: 'Alexandra Example' }]
);
assert.equal(uncertain.status, 'not_found');
assert.match(uncertain.googleScholarUrl, /Alex\+Example/);

const printedOrcid = mapOpenAlexProfile({ text: 'Known Researcher', orcid: '0000-0002-1825-0097' }, []);
assert.equal(printedOrcid.status, 'found');
assert.equal(printedOrcid.orcidUrl, 'https://orcid.org/0000-0002-1825-0097');

const duplicateRecords = mapOpenAlexProfile({ text: 'Johan Rooryck' }, [
  { id: 'https://openalex.org/A1', display_name: 'Johan Rooryck', orcid: 'https://orcid.org/0000-0001-7214-7405', works_count: 153, cited_by_count: 2009 },
  { id: 'https://openalex.org/A2', display_name: 'Johan Rooryck', orcid: 'https://orcid.org/0000-0001-7214-7405', works_count: 1, cited_by_count: 1 }
]);
assert.equal(duplicateRecords.openAlexUrl, 'https://openalex.org/A1');

const result = await lookupAuthorProfiles(
  { authors: [{ text: 'Ada Author', orcid: '' }, { text: 'No Match' }] },
  { fetchImpl: async () => ({ ok: true, json: async () => ({ results: [{ id: 'https://openalex.org/A9', display_name: 'Ada Author', works_count: 2, cited_by_count: 5 }] }) }), env: {} }
);
assert.equal(result.status, 200);
assert.equal(result.value.authors[0].status, 'found');
assert.equal(result.value.authors[1].status, 'not_found');

const unavailable = await lookupAuthorProfiles({ authors: [{ text: 'Unavailable Author' }] }, { fetchImpl: async () => { throw new Error('provider unavailable'); }, env: {} });
assert.equal(unavailable.value.authors[0].status, 'unavailable');
assert.match(unavailable.value.authors[0].googleScholarUrl, /Unavailable\+Author/);

let throttledCalls = 0;
const throttled = await lookupAuthorProfiles({ authors: [{ text: 'First Throttle' }, { text: 'Second Throttle' }] }, {
  fetchImpl: async () => { throttledCalls += 1; const error = new Error('OpenAlex lookup failed (429).'); error.status = 429; throw error; },
  env: {}
});
assert.equal(throttledCalls, 1);
assert.deepEqual(throttled.value.authors.map((profile) => profile.status), ['unavailable', 'unavailable']);

console.log('author profiles: ok');
