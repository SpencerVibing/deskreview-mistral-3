import { validateDeclaredSource } from './source-anchor.js';

const source = (value = {}) => ({ source: value.source });

function sourceIsValid(pages, value) {
  return Boolean(validateDeclaredSource(pages, source(value)));
}

function chunkAnnotation(record = {}) {
  return record.annotation || record;
}

function sourceParts(value = {}) {
  const page = /^ocr-page-(\d+)$/.exec(String(value?.source?.ocr_page_id || ''));
  const block = /^ocr-block-(\d+)-(\d+)$/.exec(String(value?.source?.ocr_block_id || ''));
  return {
    pageIndex: page ? Number(page[1]) : (Number.isInteger(value?.source?.ocr_page_index) ? value.source.ocr_page_index : Number.MAX_SAFE_INTEGER),
    blockIndex: block ? Number(block[2]) : Number.MAX_SAFE_INTEGER
  };
}

function sourceOrder(first, second) {
  const left = sourceParts(first);
  const right = sourceParts(second);
  if (left.pageIndex !== right.pageIndex) return left.pageIndex - right.pageIndex;
  if (left.blockIndex !== right.blockIndex) return left.blockIndex - right.blockIndex;
  return 0;
}

function stableHash(value = '') {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function sourceHandle(kind, item = {}) {
  const { pageIndex, blockIndex } = sourceParts(item);
  const sourceQuote = item?.source?.exact_quote || '';
  const itemIdentity = item?.id || item?.item_exact_quote || item?.label || item?.text || '';
  return `${kind}:p${pageIndex}:b${blockIndex}:q${stableHash(`${sourceQuote}\u001f${itemIdentity}`)}`;
}

function sorted(items = []) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((first, second) => sourceOrder(first.item, second.item) || first.index - second.index)
    .map(({ item }) => item);
}

function sourceValidOrUnchecked(pages, item) {
  return !Array.isArray(pages) || sourceIsValid(pages, item);
}

/**
 * Projects page-range annotations without combining model-authored entities.
 * Handles are opaque transport IDs, derived from source position and the
 * model-returned item identity so distinct items in one OCR block cannot collide.
 */
export function projectAnnotationChunks(chunks = [], { pages = null } = {}) {
  const front = { authors: [], affiliations: [], keywords: [], abstracts: [], abstract_blocks: [], titles: [] };
  const body = { sections: [], prose_blocks: [], display_items: [] };
  const references = { references: [] };
  const candidates = { displays: [], display_mentions: [], citation_mentions: [] };
  const annotations = chunks.map(chunkAnnotation);

  annotations.forEach((chunk) => {
    const frontMatter = chunk.front_matter || {};
    const authorIds = new Map((frontMatter.authors || []).map((item) => [item.id, sourceHandle('author', item)]));
    const affiliationIds = new Map((frontMatter.affiliations || []).map((item) => [item.id, sourceHandle('affiliation', item)]));
    const affiliationsByAuthor = new Map((frontMatter.authors || []).map((item) => [item.id, []]));
    const authorsByAffiliation = new Map((frontMatter.affiliations || []).map((item) => [item.id, []]));
    (frontMatter.author_affiliation_links || []).forEach((link) => {
      if (!authorIds.has(link.author_id) || !affiliationIds.has(link.affiliation_id)) return;
      affiliationsByAuthor.get(link.author_id).push(affiliationIds.get(link.affiliation_id));
      authorsByAffiliation.get(link.affiliation_id).push(authorIds.get(link.author_id));
    });
    (frontMatter.titles || []).filter((item) => sourceValidOrUnchecked(pages, item)).forEach((item) => front.titles.push({ text: item.label, ...source(item) }));
    (frontMatter.authors || []).filter((item) => sourceValidOrUnchecked(pages, item)).forEach((item) => front.authors.push({ _projection_id: authorIds.get(item.id), text: item.label, orcid: item.orcid, affiliation_projection_ids: affiliationsByAuthor.get(item.id) || [], ...source(item) }));
    (frontMatter.affiliations || []).filter((item) => sourceValidOrUnchecked(pages, item)).forEach((item) => front.affiliations.push({ _projection_id: affiliationIds.get(item.id), text: item.label, item_exact_quote: item.item_exact_quote, author_projection_ids: authorsByAffiliation.get(item.id) || [], ...source(item) }));
    (frontMatter.keywords || []).filter((item) => sourceValidOrUnchecked(pages, item)).forEach((item) => front.keywords.push({ text: item.label, item_exact_quote: item.item_exact_quote, ...source(item) }));
    (frontMatter.abstracts || []).filter((item) => sourceValidOrUnchecked(pages, item)).forEach((item) => front.abstracts.push({ ...source(item) }));

    (chunk.body?.sections || []).filter((item) => sourceValidOrUnchecked(pages, item)).forEach((item) => body.sections.push({ id: item.id, heading: item.heading, level: item.level, ...source(item) }));
    Object.entries(chunk.body?.prose_block_types || {}).forEach(([id, type]) => {
      if (type === 'article') body.prose_blocks.push(id);
      if (type === 'abstract') front.abstract_blocks.push(id);
    });
    (chunk.body?.display_mentions || []).filter((item) => sourceValidOrUnchecked(pages, item)).forEach((item) => candidates.display_mentions.push({ handle: sourceHandle('display-mention', item), citation_text: item.label, ...source(item) }));
    (chunk.displays?.entries || []).filter((item) => sourceValidOrUnchecked(pages, item)).forEach((item) => {
      const link_handle = sourceHandle('display', item);
      body.display_items.push({ kind: item.kind, label: item.label, link_handle, body_occurrences: [], ...source(item) });
      candidates.displays.push({ handle: link_handle, kind: item.kind, label: item.label, ...source(item) });
    });
    const bibliographyEntries = chunk.bibliography?.blocks && typeof chunk.bibliography.blocks === 'object'
      ? Object.values(chunk.bibliography.blocks).flatMap((items) => Array.isArray(items) ? items : [])
      : (chunk.bibliography?.entries || []);
    bibliographyEntries.forEach((item) => {
      references.references.push({ text: item.text, ...source(item) });
    });
  });

  front.titles = sorted(front.titles);
  const sortedAuthors = sorted(front.authors);
  const sortedAffiliations = sorted(front.affiliations);
  const authorIndexByProjectionId = new Map(sortedAuthors.map((item, index) => [item._projection_id, index]));
  const affiliationIndexByProjectionId = new Map(sortedAffiliations.map((item, index) => [item._projection_id, index]));
  front.authors = sortedAuthors.map(({ _projection_id, affiliation_projection_ids = [], ...item }) => ({
    ...item,
    affiliation_indexes: affiliation_projection_ids.map((id) => affiliationIndexByProjectionId.get(id)).filter(Number.isInteger)
  }));
  front.affiliations = sortedAffiliations.map(({ _projection_id, author_projection_ids = [], ...item }) => ({
    ...item,
    author_indexes: author_projection_ids.map((id) => authorIndexByProjectionId.get(id)).filter(Number.isInteger)
  }));
  front.keywords = sorted(front.keywords);
  body.sections = sorted(body.sections);
  body.display_items = sorted(body.display_items);
  references.references = sorted(references.references).map((item, index) => ({ ...item, number: index + 1 }));
  candidates.displays = sorted(candidates.displays);
  candidates.display_mentions = sorted(candidates.display_mentions);
  candidates.citation_mentions = sorted(candidates.citation_mentions);

  const abstract = front.abstracts.length === 1
    ? { ...front.abstracts[0], prose_blocks: front.abstract_blocks }
    : (front.abstract_blocks.length ? { prose_blocks: front.abstract_blocks } : {});

  return {
    annotation: {
      front_matter: { title: front.titles.length === 1 ? front.titles[0] : {}, authors: front.authors, affiliations: front.affiliations, keywords: front.keywords, abstract },
      body,
      references
    },
    candidates
  };
}

export function validSourceLinkPacket(pages = [], candidates = {}) {
  const all = ['displays', 'display_mentions'].flatMap((key) => candidates[key] || []);
  return all.every((item) => typeof item.handle === 'string' && item.handle && sourceIsValid(pages, item));
}

/**
 * Document QnA maps model-authored handles. Exact source anchors are checked
 * independently when each returned occurrence is rendered in the reader.
 */
export function hasSourceLinkCandidates(candidates = {}) {
  const groups = ['displays', 'display_mentions'];
  return groups.every((key) => Array.isArray(candidates[key]) && candidates[key].every((item) => (
    item && typeof item.handle === 'string' && item.handle.trim() && item.source && typeof item.source.exact_quote === 'string' && item.source.exact_quote.trim()
  )));
}

export function buildSourceLinkPacket(pages = [], candidates = {}) {
  if (!validSourceLinkPacket(pages, candidates)) throw new TypeError('Annotation candidates are not all backed by returned OCR text.');
  return {
    pages: pages.map((page, pageIndex) => ({ ocr_page_index: pageIndex, markdown: String(page.markdown || page.content || '') })),
    candidates: {
      displays: candidates.displays || []
    }
  };
}

/** Applies only exact model-returned opaque handles. It never creates or selects links. */
export function applySourceLinks(annotation = {}, candidates = {}, links = {}) {
  const displayLinks = new Map((candidates.displays || []).map((item) => [item.handle, []]));
  const displayMentions = new Map((candidates.display_mentions || []).map((item) => [item.handle, item]));
  (links.display_mappings || []).forEach((mapping) => {
    const mention = displayMentions.get(mapping.mention_handle);
    if (!mention) return;
    (mapping.display_handles || []).forEach((handle) => displayLinks.get(handle)?.push({ citation_text: mention.citation_text, context_quote: mention.source?.exact_quote || '', source: mention.source }));
  });
  return {
    ...annotation,
    body: {
      ...annotation.body,
      display_items: (annotation.body?.display_items || []).map((item) => ({
        ...item,
        body_occurrences: displayLinks.has(item.link_handle) ? displayLinks.get(item.link_handle) : (item.body_occurrences || [])
      }))
    },
    references: annotation.references
  };
}
