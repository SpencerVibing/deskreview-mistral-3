function text(value = '') { return String(value || '').trim(); }

export function authorLookupName(value = '') {
  return text(value)
    .replace(/\*\*/g, '')
    .replace(/\([^)]*\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}[^)]*\)/g, '')
    .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰*†‡]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAuthorName(value = '') {
  return authorLookupName(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\b(?:md|phd|msc|dr)\b\.?/gi, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLocaleLowerCase();
}

export function normalizeOrcid(value = '') {
  const match = text(value).match(/(?:https?:\/\/orcid\.org\/)?([0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9Xx])/);
  return match ? match[1].toUpperCase() : '';
}

export function googleScholarUrl(name = '') {
  return `https://scholar.google.com/scholar?${new URLSearchParams({ q: text(name) }).toString()}`;
}

export function mapOpenAlexProfile(author = {}, candidates = []) {
  const authorName = text(author.text || author.name);
  const exact = candidates.filter((candidate) => normalizeAuthorName(candidate.display_name) === normalizeAuthorName(authorName));
  const exactOrcids = Array.from(new Set(exact.map((candidate) => normalizeOrcid(candidate.orcid)).filter(Boolean)));
  const candidate = exact.length === 1
    ? exact[0]
    : (exactOrcids.length === 1
      ? exact.filter((entry) => normalizeOrcid(entry.orcid) === exactOrcids[0]).sort((left, right) => Number(right.works_count || 0) - Number(left.works_count || 0))[0]
      : null);
  const orcid = normalizeOrcid(author.orcid) || normalizeOrcid(candidate?.orcid);
  if (!candidate) {
    if (orcid) return { name: authorName, status: 'found', openAlexUrl: '', orcidUrl: `https://orcid.org/${encodeURIComponent(orcid)}`, worksCount: 0, citedByCount: 0 };
    return { name: authorName, status: 'not_found', googleScholarUrl: googleScholarUrl(authorName) };
  }
  const openAlexId = text(candidate.id).replace(/^https?:\/\/openalex\.org\//i, '');
  return {
    name: authorName,
    status: 'found',
    openAlexUrl: openAlexId ? `https://openalex.org/${encodeURIComponent(openAlexId)}` : '',
    orcidUrl: orcid ? `https://orcid.org/${encodeURIComponent(orcid)}` : '',
    worksCount: Number(candidate.works_count || 0),
    citedByCount: Number(candidate.cited_by_count || 0)
  };
}
