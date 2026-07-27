function pageText(page = {}) {
  const primary = String(page.markdown || page.content || (page.blocks || []).map((block) => block.content || '').join('\n'));
  const tables = (page.tables || []).map((table) => String(table.content || '')).filter((table) => table && !primary.includes(table));
  return [primary, ...tables].filter(Boolean).join('\n');
}

/**
 * Validates, but never repairs, a model-authored source anchor. The caller may
 * render the returned location only when the exact quoted text is present on
 * the exact model-declared page.
 */
export function validateDeclaredSource(pages = [], item = {}) {
  const pageNumber = Number(item?.source?.page_number || 0);
  const quote = String(item?.source?.exact_quote || '').trim();
  if (!quote || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.length) return null;
  const page = pages[pageNumber - 1];
  if (!pageText(page).includes(quote)) return null;
  return { pageNumber, quote };
}

