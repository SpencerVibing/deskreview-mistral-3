export function plain(value = '') {
  const doc = new DOMParser().parseFromString(String(value || ''), 'text/html');
  return (doc.body.textContent || '').trim();
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function renderMath(value = '') {
  return String(value).replace(/\\(?:sigma)/g, 'σ').replace(/\\(?:psi)/g, 'ψ').replace(/\\(?:phi)/g, 'φ').replace(/\\(?:approx)/g, '≈').replace(/\\(?:sim)/g, '∼').replace(/\\(?:leq)/g, '≤').replace(/\\(?:geq)/g, '≥').replace(/\\(?:times)/g, '×').replace(/\\(?:cdot)/g, '·').replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '<span class="ocr-fraction"><sup>$1</sup><span>/</span><sub>$2</sub></span>').replace(/([A-Za-z0-9)})])\^\{([^{}]+)\}/g, '$1<sup>$2</sup>').replace(/([A-Za-z0-9)})])_\{([^{}]+)\}/g, '$1<sub>$2</sub>');
}

export function inlineMarkdown(value = '') {
  const maths = [];
  let output = escapeHtml(value).replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => `@@DRMATH${maths.push(math) - 1}@@`);
  output = output.replace(/!\[[^\]]*\]\([^\n)]*\)/g, '').replace(/\[([^\]]+)\]\([^\n)]*\.html\)/gi, '$1');
  output = output.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>').replace(/__([\s\S]+?)__/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  return output.replace(/@@DRMATH(\d+)@@/g, (_, index) => `<span class="ocr-math">${renderMath(maths[Number(index)])}</span>`);
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
