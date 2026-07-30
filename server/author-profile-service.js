import { authorLookupName, googleScholarUrl, mapOpenAlexProfile } from '../core/author-profiles.js';
import { searchOpenAlexAuthors } from '../services/openalex.js';

const MAX_AUTHORS = 50;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const profileCache = new Map();

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function mapWithConcurrency(items, mapper, concurrency = 1, intervalMs = 150) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]);
      if (next < items.length) await sleep(intervalMs);
    }
  }));
  return results;
}

export async function lookupAuthorProfiles(payload = {}, { fetchImpl = fetch, env = process.env } = {}) {
  const authors = Array.isArray(payload.authors) ? payload.authors.slice(0, MAX_AUTHORS).filter((author) => String(author?.text || author?.name || '').trim()) : [];
  if (!authors.length) return { status: 400, value: { error: 'Provide at least one author name.' } };
  let providerThrottled = false;
  const authorsWithProfiles = await mapWithConcurrency(authors, async (author) => {
    const name = String(author.text || author.name || '').trim();
    const cacheKey = authorLookupName(name).toLocaleLowerCase();
    const cached = profileCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached.profile;
    if (providerThrottled) return { name, status: 'unavailable', googleScholarUrl: googleScholarUrl(name) };
    try {
      const profile = mapOpenAlexProfile(author, await searchOpenAlexAuthors(authorLookupName(name), { fetchImpl, env }));
      profileCache.set(cacheKey, { createdAt: Date.now(), profile });
      return profile;
    } catch (error) {
      if (Number(error?.status) === 429) providerThrottled = true;
      return { name, status: 'unavailable', googleScholarUrl: googleScholarUrl(name) };
    }
  }, Number(env.OPENALEX_LOOKUP_CONCURRENCY || 1), Number(env.OPENALEX_REQUEST_INTERVAL_MS || 150));
  return { status: 200, value: { source: 'openalex', authors: authorsWithProfiles } };
}
