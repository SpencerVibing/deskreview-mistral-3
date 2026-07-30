function pageText(page = {}) {
  const primary = String(page.markdown || page.content || (page.blocks || []).map((block) => block.content || '').join('\n'));
  const tables = (page.tables || []).map((table) => String(table.content || '')).filter((table) => table && !primary.includes(table));
  return [primary, ...tables].filter(Boolean).join('\n');
}

function comparableText(value = '') {
  return String(value)
    .replace(/!\[[^\]]*\]\([^\n)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[\*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueMatchingBlockIndex(page = {}, quote = '') {
  const comparableQuote = comparableText(quote);
  const matches = (page.blocks || []).flatMap((block, index) => comparableText(block?.content).includes(comparableQuote) ? [index] : []);
  return matches.length === 1 ? matches[0] : null;
}

function uniqueMatchingSource(pages = [], quote = '') {
  const comparableQuote = comparableText(quote);
  const blockMatches = pages.flatMap((page, pageIndex) => (page.blocks || []).flatMap((block, blockIndex) => (
    comparableText(block?.content).includes(comparableQuote) ? [{ pageIndex, blockIndex }] : []
  )));
  if (blockMatches.length === 1) return blockMatches[0];
  if (blockMatches.length > 1) return null;
  // OCR may put a field label and its list into adjacent blocks while retaining
  // their exact sequence in page markdown. Accept that unique page-level anchor.
  const pageMatches = pages.flatMap((page, pageIndex) => comparableText(pageText(page)).includes(comparableQuote) ? [{ pageIndex, blockIndex: null }] : []);
  return pageMatches.length === 1 ? pageMatches[0] : null;
}

/** Binds a model-authored exact quote only at its declared returned OCR page. */
export function validateDeclaredSource(pages = [], item = {}) {
  const pageId = String(item?.source?.ocr_page_id || '');
  const pageIdMatch = /^ocr-page-(\d+)$/.exec(pageId);
  const blockIdMatch = /^ocr-block-(\d+)-(\d+)$/.exec(String(item?.source?.ocr_block_id || ''));
  const ocrPageIndex = item?.source?.ocr_page_index;
  const pageNumber = Number(item?.source?.page_number || 0);
  const hasOcrPageIndex = Number.isInteger(ocrPageIndex) && ocrPageIndex >= 0;
  const hasPageNumber = Number.isInteger(pageNumber) && pageNumber >= 1;
  const quote = String(item?.source?.exact_quote || '').trim();
  if (!quote) return null;
  if (!pageIdMatch && !blockIdMatch && !hasOcrPageIndex && !hasPageNumber) {
    const match = uniqueMatchingSource(pages, quote);
    return match ? { pageNumber: match.pageIndex + 1, ...(match.blockIndex === null ? {} : { blockIndex: match.blockIndex }), quote } : null;
  }
  if (blockIdMatch) {
    const pageIndex = Number(blockIdMatch[1]);
    const blockIndex = Number(blockIdMatch[2]);
    const block = pages[pageIndex]?.blocks?.[blockIndex];
    if (pageIdMatch && Number(pageIdMatch[1]) !== pageIndex) return null;
    if (pageIndex >= 0 && pageIndex < pages.length && block && comparableText(block.content).includes(comparableText(quote))) return { pageNumber: pageIndex + 1, blockIndex, quote };
    return null;
  }
  if (pageIdMatch) {
    const pageIndex = Number(pageIdMatch[1]);
    if (pageIndex >= 0 && pageIndex < pages.length && comparableText(pageText(pages[pageIndex])).includes(comparableText(quote))) return { pageNumber: pageIndex + 1, quote };
    return null;
  }
  if (hasOcrPageIndex && ocrPageIndex < pages.length) {
    const page = pages[ocrPageIndex];
    const blockIndex = uniqueMatchingBlockIndex(page, quote);
    if (blockIndex !== null) return { pageNumber: ocrPageIndex + 1, blockIndex, quote };
    if (!(page.blocks || []).length && comparableText(pageText(page)).includes(comparableText(quote))) return { pageNumber: ocrPageIndex + 1, quote };
  }
  if (hasPageNumber && pageNumber <= pages.length && comparableText(pageText(pages[pageNumber - 1])).includes(comparableText(quote))) return { pageNumber, quote };
  return null;
}
