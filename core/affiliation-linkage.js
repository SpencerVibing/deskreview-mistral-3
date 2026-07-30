function array(value) { return Array.isArray(value) ? value : []; }

/** Projects only model-authored affiliation indexes; it never infers a relationship. */
export function projectAffiliationLinkage(frontMatter = {}) {
  const authors = array(frontMatter.authors);
  const affiliations = array(frontMatter.affiliations);
  const available = authors.every((author) => Array.isArray(author?.affiliation_indexes))
    && affiliations.every((affiliation) => Array.isArray(affiliation?.author_indexes));
  const linkedAuthors = authors.map((author, index) => ({ ...author, index, linkedAffiliationIndexes: array(author?.affiliation_indexes) }));
  const linkedAffiliations = affiliations.map((affiliation, index) => ({
    ...affiliation,
    index,
    linkedAuthorIndexes: array(affiliation?.author_indexes),
    linkedAuthors: array(affiliation?.author_indexes).map((authorIndex) => authors[authorIndex]).filter(Boolean)
  }));
  return {
    available,
    authors: linkedAuthors,
    affiliations: linkedAffiliations,
    authorLinked: linkedAuthors.filter((author) => author.linkedAffiliationIndexes.length > 0).length,
    affiliationLinked: linkedAffiliations.filter((affiliation) => affiliation.linkedAuthorIndexes.length > 0).length
  };
}
