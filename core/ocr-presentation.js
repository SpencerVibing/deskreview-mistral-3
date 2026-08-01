function consecutiveRunLength(values = []) {
  const ordered = [...new Set(values)].sort((left, right) => left - right);
  let longest = 0;
  let current = 0;
  let previous = null;
  ordered.forEach((value) => {
    current = value === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = value;
  });
  return longest;
}

/**
 * Identifies printed line-number gutters from OCR geometry, for rendering only.
 * It never changes the immutable OCR source used for analysis or source links.
 */
export function hasLineNumberGutter(blocks = []) {
  const positioned = blocks.filter((block) => Number.isFinite(Number(block?.top_left_x)));
  if (!positioned.length) return false;
  const leftEdge = Math.min(...positioned.map((block) => Number(block.top_left_x)));
  const gutterNumbers = positioned.flatMap((block) => {
    if (Number(block.top_left_x) > leftEdge + 24) return [];
    const match = /^\s*(\d{1,4})\s*$/.exec(String(block.content || ''));
    return match ? [Number(match[1])] : [];
  });
  return consecutiveRunLength(gutterNumbers) >= 5;
}

export function ocrMarkdownForPresentation(page = {}) {
  const markdown = String(page.markdown || page.content || (page.blocks || []).map((block) => block.content || '').join('\n\n'));
  if (!hasLineNumberGutter(page.blocks || [])) return markdown;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*\d{1,4}\s*$/.test(line)) return '';
      return line.replace(/^\s*\d{1,4}\s+(?=\S)/, '');
    })
    .join('\n');
}
