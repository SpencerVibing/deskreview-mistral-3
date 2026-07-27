/** Projects the single model-authored document map into the reader's existing UI groups. */
export function projectAnnotation(annotation = {}) {
  return {
    'front-matter': annotation.front_matter || {},
    body: annotation.body || {},
    references: annotation.references || {}
  };
}
