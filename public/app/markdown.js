export function plain(value = '') {
  const doc = new DOMParser().parseFromString(String(value || ''), 'text/html');
  return (doc.body.textContent || '').trim();
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

export function inlineMarkdown(value = '') {
  const maths = [];
  // Preserve OCR TeX verbatim while applying Markdown formatting around it. KaTeX
  // renders these text nodes after the complete OCR page has been mounted.
  let output = escapeHtml(value).replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g, (math) => `@@DRTEX${maths.push(math) - 1}@@`);
  output = output.replace(/!\[[^\]]*\]\([^\n)]*\)/g, '').replace(/\[([^\]]+)\]\([^\n)]*\.html\)/gi, '$1');
  output = output.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>').replace(/__([\s\S]+?)__/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  return output.replace(/@@DRTEX(\d+)@@/g, (_, index) => maths[Number(index)]);
}

export function markdownLabel(value = '') {
  return plain(String(value).replace(/\*\*([\s\S]+?)\*\*/g, '$1').replace(/__([\s\S]+?)__/g, '$1').replace(/\*([^*\n]+)\*/g, '$1').replace(/_([^_\n]+)_/g, '$1')).replace(/\s+/g, ' ').trim();
}

export function headingLabel(value = '') {
  return markdownLabel(plain(value).replace(/^#{1,6}\s*/, ''));
}

/** Render OCR markdown as text flow without deleting or interpreting OCR lines. */
export function renderMarkdown(value = '') {
  return String(value || '').split(/\n{2,}/).map((block) => block.trim().split(/\n+/).join(' ')).filter(Boolean).join('\n\n');
}
