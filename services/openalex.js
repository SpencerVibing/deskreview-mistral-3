const OPENALEX_AUTHORS_URL = 'https://api.openalex.org/authors';

export async function searchOpenAlexAuthors(name, { fetchImpl = fetch, env = process.env } = {}) {
  const params = new URLSearchParams({ search: String(name || ''), 'per-page': '5', select: 'id,display_name,orcid,works_count,cited_by_count' });
  if (env.OPENALEX_MAILTO) params.set('mailto', env.OPENALEX_MAILTO);
  const response = await fetchImpl(`${OPENALEX_AUTHORS_URL}?${params.toString()}`, { signal: AbortSignal.timeout(Number(env.OPENALEX_TIMEOUT_MS || 8000)), headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const error = new Error(`OpenAlex lookup failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results : [];
}
