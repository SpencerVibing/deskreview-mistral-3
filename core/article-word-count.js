function pageText(page = {}) {
  return String(page.markdown || page.content || (page.blocks || []).map((block) => block?.content || '').join('\n'));
}

function normalizedWithOffsets(value = '') {
  const input = String(value);
  let normalized = '';
  const offsets = [];
  let previousWhitespace = false;
  const append = (character, index) => {
    if (/\s/.test(character)) {
      if (!previousWhitespace) {
        normalized += ' ';
        offsets.push(index);
      }
      previousWhitespace = true;
      return;
    }
    previousWhitespace = false;
    normalized += character;
    offsets.push(index);
  };
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (input.startsWith('![', index)) {
      const imageEnd = input.indexOf(')', input.indexOf('](', index + 2));
      if (imageEnd >= 0) {
        index = imageEnd;
        continue;
      }
    }
    if (character === '[') {
      const labelEnd = input.indexOf('](', index + 1);
      const linkEnd = labelEnd >= 0 ? input.indexOf(')', labelEnd + 2) : -1;
      if (linkEnd >= 0) {
        for (let labelIndex = index + 1; labelIndex < labelEnd; labelIndex += 1) append(input[labelIndex], labelIndex);
        index = linkEnd;
        continue;
      }
    }
    if (character === '#' && (index === 0 || input[index - 1] === '\n')) {
      while (input[index + 1] === '#') index += 1;
      while (/\s/.test(input[index + 1] || '')) index += 1;
      continue;
    }
    if ('*_`'.includes(character)) continue;
    append(character, index);
  }
  const firstContent = normalized.search(/\S/);
  if (firstContent < 0) return { normalized: '', offsets: [] };
  let lastContent = normalized.length;
  while (lastContent > firstContent && normalized[lastContent - 1] === ' ') lastContent -= 1;
  return {
    normalized: normalized.slice(firstContent, lastContent),
    offsets: offsets.slice(firstContent, lastContent)
  };
}

function locateQuote(value, quote) {
  const text = normalizedWithOffsets(value);
  const target = normalizedWithOffsets(quote).normalized;
  if (!target) return null;
  const first = text.normalized.indexOf(target);
  if (first < 0 || text.normalized.indexOf(target, first + target.length) >= 0) return null;
  return { start: text.offsets[first], end: text.offsets[first + target.length - 1] + 1 };
}

function boundary(pages = [], value = {}) {
  const pageIdMatch = /^ocr-page-(\d+)$/.exec(String(value?.ocr_page_id || ''));
  const pageIndex = pageIdMatch ? Number(pageIdMatch[1]) : (Number.isInteger(value?.page_number) ? value.page_number - 1 : value?.ocr_page_index);
  const quote = String(value?.exact_quote || '');
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length || !quote) return null;
  const text = pageText(pages[pageIndex]);
  const location = locateQuote(text, quote);
  return location ? { pageIndex, text, ...location } : null;
}

function rangeText(pages, range) {
  const start = boundary(pages, range?.start);
  const end = boundary(pages, range?.end);
  if (!start || !end || end.pageIndex < start.pageIndex || (start.pageIndex === end.pageIndex && end.end < start.start)) return null;
  if (start.pageIndex === end.pageIndex) return { text: start.text.slice(start.start, end.end), start, end };
  const parts = [start.text.slice(start.start)];
  for (let index = start.pageIndex + 1; index < end.pageIndex; index += 1) parts.push(pageText(pages[index]));
  parts.push(end.text.slice(0, end.end));
  return { text: parts.join('\n'), start, end };
}

function countWords(text = '') {
  return String(text).match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length || 0;
}

export const wordCountTokenizer = 'unicode-letter-number-apostrophe-hyphen-v1';

function blockBoundary(pages = [], value = {}) {
  const sourceKey = typeof value === 'string' ? value.trim() : String(value?.raw_ocr_block_key || '').trim();
  const keyMatch = /^(ocr-block-(\d+)-(\d+)) :: (.+)$/.exec(sourceKey);
  if (keyMatch) {
    const pageIndex = Number(keyMatch[2]);
    const blockIndex = Number(keyMatch[3]);
    const block = pages[pageIndex]?.blocks?.[blockIndex];
    if (!block || !locateQuote(String(block.content || ''), keyMatch[4])) return null;
    return { pageIndex, blockIndex, text: String(block.content || '') };
  }
  const blockIdMatch = /^ocr-block-(\d+)-(\d+)$/.exec(sourceKey);
  if (blockIdMatch) {
    const pageIndex = Number(blockIdMatch[1]);
    const blockIndex = Number(blockIdMatch[2]);
    const block = pages[pageIndex]?.blocks?.[blockIndex];
    return block ? { pageIndex, blockIndex, text: String(block.content || '') } : null;
  }
  const rawAnchor = String(value?.raw_ocr_anchor || (typeof value === 'string' ? value : '')).trim();
  if (rawAnchor) {
    const matches = pages.flatMap((page, pageIndex) => (page.blocks || []).flatMap((block, blockIndex) => {
      const location = locateQuote(String(block?.content || ''), rawAnchor);
      return location ? [{ pageIndex, blockIndex, text: String(block.content || '') }] : [];
    }));
    return matches.length === 1 ? matches[0] : null;
  }
  const match = /^ocr-block-(\d+)-(\d+)$/.exec(String(value?.ocr_block_id || ''));
  const quote = String(value?.exact_quote || '').trim();
  if (!match || !quote) return null;
  const pageIndex = Number(match[1]);
  const blockIndex = Number(match[2]);
  const pageId = /^ocr-page-(\d+)$/.exec(String(value?.ocr_page_id || ''));
  const block = pages[pageIndex]?.blocks?.[blockIndex];
  if (!block || (pageId && Number(pageId[1]) !== pageIndex)) return null;
  const location = locateQuote(String(block.content || ''), quote);
  return location ? { pageIndex, blockIndex, text: String(block.content || '') } : null;
}

/** Counts only model-authored, non-overlapping raw-OCR prose spans. */
export function countArticleWordsFromRanges(pages = [], ranges = []) {
  if (!Array.isArray(ranges) || !ranges.length) return { valid: false, count: null };
  let previousEnd = null;
  const fragments = [];
  for (const range of ranges) {
    const resolved = rangeText(pages, range);
    if (!resolved) return { valid: false, count: null };
    const currentStart = [resolved.start.pageIndex, resolved.start.start];
    const currentEnd = [resolved.end.pageIndex, resolved.end.end];
    if (previousEnd && (currentStart[0] < previousEnd[0] || (currentStart[0] === previousEnd[0] && currentStart[1] <= previousEnd[1]))) return { valid: false, count: null };
    previousEnd = currentEnd;
    fragments.push(normalizedWithOffsets(resolved.text).normalized);
  }
  return { valid: true, count: countWords(fragments.join('\n')) };
}

/** Counts only complete raw OCR blocks explicitly selected by the annotation model. */
export function countArticleWordsFromBlocks(pages = [], proseBlocks = []) {
  if (!Array.isArray(proseBlocks) || !proseBlocks.length) return { valid: false, count: null };
  const seen = new Set();
  let count = 0;
  for (const proseBlock of proseBlocks) {
    const source = proseBlock?.source || proseBlock;
    const resolved = blockBoundary(pages, source);
    if (!resolved) return { valid: false, count: null };
    const key = `${resolved.pageIndex}:${resolved.blockIndex}`;
    if (seen.has(key)) return { valid: false, count: null };
    seen.add(key);
    count += countWords(normalizedWithOffsets(resolved.text.replace(/<[^>]*>/g, ' ')).normalized);
  }
  return { valid: true, count };
}

/** Returns the exact complete raw OCR blocks explicitly selected by the annotation model. */
export function textFromArticleBlocks(pages = [], proseBlocks = []) {
  if (!Array.isArray(proseBlocks) || !proseBlocks.length) return { valid: false, fragments: [] };
  const seen = new Set();
  const fragments = [];
  for (const proseBlock of proseBlocks) {
    const source = proseBlock?.source || proseBlock;
    const resolved = blockBoundary(pages, source);
    if (!resolved) return { valid: false, fragments: [] };
    const key = `${resolved.pageIndex}:${resolved.blockIndex}`;
    if (seen.has(key)) return { valid: false, fragments: [] };
    seen.add(key);
    fragments.push(normalizedWithOffsets(resolved.text.replace(/<[^>]*>/g, ' ')).normalized);
  }
  return { valid: true, fragments };
}

/** Builds reproducible provenance for exact OCR blocks selected by the annotation model. */
export function wordCountProvenanceFromBlocks(pages = [], proseBlocks = []) {
  if (!Array.isArray(proseBlocks) || !proseBlocks.length) return { valid: false, count: null, block_ids: [], fragments: [], tokenizer: wordCountTokenizer };
  const seen = new Set();
  const block_ids = [];
  const fragments = [];
  for (const proseBlock of proseBlocks) {
    const source = proseBlock?.source || proseBlock;
    const resolved = blockBoundary(pages, source);
    if (!resolved) return { valid: false, count: null, block_ids: [], fragments: [], tokenizer: wordCountTokenizer };
    const key = `ocr-block-${resolved.pageIndex}-${resolved.blockIndex}`;
    if (seen.has(key)) return { valid: false, count: null, block_ids: [], fragments: [], tokenizer: wordCountTokenizer };
    seen.add(key);
    block_ids.push(key);
    fragments.push(normalizedWithOffsets(resolved.text.replace(/<[^>]*>/g, ' ')).normalized);
  }
  return { valid: true, count: countWords(fragments.join('\n')), block_ids, fragments, tokenizer: wordCountTokenizer };
}
