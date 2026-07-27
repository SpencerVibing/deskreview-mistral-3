import { getDocument, GlobalWorkerOptions } from '/vendor/pdfjs/build/pdf.mjs';
import { initHome, refreshHome } from '/home.js';
import { loadReview, saveReview } from '/review-store.js';
import { validateDeclaredSource } from '/core/source-anchor.js';
import { createRuntimeLog } from '/app/runtime-log.js';

GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.mjs';

const el = (selector) => document.querySelector(selector);
const state = { tocWidth: 288, countsWidth: 448, resizing: null, raw: null, openDetailKind: '', pdf: null, pdfRenderToken: 0, pdfResizeTimer: null, annotations: { 'front-matter': null, body: null, references: null }, annotationStatus: { 'front-matter': 'idle', body: 'idle', references: 'idle' } };
const runtime = createRuntimeLog();
const input = el('#pdfInput');
const reader = el('#reader');
const pdfEmpty = el('#pdfEmpty');
const pdfCanvasHost = el('#pdfCanvasHost');
const fileName = el('#fileName');
const pdfPane = el('#pdfPane');
const htmlPane = el('#htmlPane');
const htmlDocument = el('#htmlPane .ocr-html');
const pdfMode = el('#pdfMode');
const htmlMode = el('#htmlMode');
const toc = el('#tocList');
const note = el('.counts-note');
const homeView = el('#homeView');
if (new URLSearchParams(window.location.search).get('ambient') === 'on') document.documentElement.classList.add('force-ambient-motion');

function showHome() { closeDetails(); homeView.classList.remove('d-none'); reader.classList.add('d-none'); history.replaceState({}, '', '/'); refreshHome({ onOpenReview: openHomeReview }).catch(() => {}); }
function showReader() { homeView.classList.add('d-none'); reader.classList.remove('d-none'); }

function startRuntime() { runtime.reset(); }
function recordRuntime(label, detail = '', key = label) { runtime.record(label, detail, key); }
function renderRuntimeSummary() { const container = el('#runtimeSummarySections'); const events = runtime.entries(); container.replaceChildren(); if (!events.length) { const empty = document.createElement('div'); empty.className = 'text-secondary small'; empty.textContent = 'No runtime data yet.'; container.append(empty); return; } events.forEach((event) => { const row = document.createElement('div'); row.className = 'd-flex align-items-start justify-content-between gap-3 border-bottom pb-2'; const text = document.createElement('div'); const title = document.createElement('div'); title.className = 'small fw-semibold'; title.textContent = event.label; const detail = document.createElement('div'); detail.className = 'small text-secondary mt-1'; detail.textContent = event.detail; text.append(title); if (event.detail) text.append(detail); const time = document.createElement('time'); time.className = 'small text-secondary text-nowrap'; time.textContent = `+${(event.elapsedMs / 1000).toFixed(1)} s`; row.append(text, time); container.append(row); }); }
function setMode(mode) { const pdf = mode === 'pdf'; pdfPane.classList.toggle('d-none', !pdf); htmlPane.classList.toggle('d-none', pdf); pdfMode.classList.toggle('active', pdf); htmlMode.classList.toggle('active', !pdf); }
function setCount(kind, value = '—', loading = false) { const tile = el(`[data-count="${kind}"]`); if (!tile) return; tile.classList.toggle('is-loading', loading); tile.querySelector('strong').textContent = value; }
function showProgress() { toc.replaceChildren(); const progress = document.createElement('div'); progress.className = 'empty-note px-2 py-3'; progress.textContent = 'Reading document structure...'; toc.append(progress); document.querySelectorAll('[data-count]').forEach((tile) => setCount(tile.dataset.count, 'Counting', true)); note.textContent = 'Reading the manuscript source.'; }
function plain(value = '') { const doc = new DOMParser().parseFromString(String(value || ''), 'text/html'); return (doc.body.textContent || '').trim(); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function renderMath(value = '') { return String(value).replace(/\\(?:sigma)/g, 'σ').replace(/\\(?:psi)/g, 'ψ').replace(/\\(?:phi)/g, 'φ').replace(/\\(?:approx)/g, '≈').replace(/\\(?:sim)/g, '∼').replace(/\\(?:leq)/g, '≤').replace(/\\(?:geq)/g, '≥').replace(/\\(?:times)/g, '×').replace(/\\(?:cdot)/g, '·').replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '<span class="ocr-fraction"><sup>$1</sup><span>/</span><sub>$2</sub></span>').replace(/([A-Za-z0-9)})])\^\{([^{}]+)\}/g, '$1<sup>$2</sup>').replace(/([A-Za-z0-9)})])_\{([^{}]+)\}/g, '$1<sub>$2</sub>'); }
function inlineMarkdown(value = '') { const maths = []; let output = escapeHtml(value).replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => `@@DRMATH${maths.push(math) - 1}@@`); output = output.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>').replace(/__([\s\S]+?)__/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>'); return output.replace(/@@DRMATH(\d+)@@/g, (_, index) => `<span class="ocr-math">${renderMath(maths[Number(index)])}</span>`); }
function markdownLabel(value = '') { return plain(String(value).replace(/\*\*([\s\S]+?)\*\*/g, '$1').replace(/__([\s\S]+?)__/g, '$1').replace(/\*([^*\n]+)\*/g, '$1').replace(/_([^_\n]+)_/g, '$1')); }
function headingLabel(value = '') { return markdownLabel(plain(value).replace(/^#{1,6}\s*/, '')); }
function stripSequentialLineNumbers(value = '') {
  const lines = String(value).split(/\r?\n/);
  const candidates = lines.map((line) => { const match = /^(\d{1,4})(?:\s+(.*))?$/.exec(line.trim()); return match ? { number: Number(match[1]), remainder: match[2] || '' } : null; });
  const numbered = new Set();
  let runStart = 0;
  while (runStart < candidates.length) {
    if (!candidates[runStart]) { runStart += 1; continue; }
    let runEnd = runStart + 1;
    while (candidates[runEnd] && candidates[runEnd].number === candidates[runEnd - 1].number + 1) runEnd += 1;
    if (runEnd - runStart >= 4) for (let index = runStart; index < runEnd; index += 1) numbered.add(index);
    runStart = runEnd;
  }
  return lines.map((line, index) => numbered.has(index) ? candidates[index].remainder : line).filter((line, index, all) => line.trim() || (index > 0 && all[index - 1].trim())).join('\n');
}
function renderMarkdown(value = '') { return stripSequentialLineNumbers(value).replace(/^!\[[^\]]*\]\([^\n)]*\)\s*$/gm, '').replace(/^\s*\[[^\]]+\.html\]\([^\n)]*\.html\)\s*$/gmi, '').split(/\n{2,}/).map((block) => block.trim().split(/\n+/).join(' ')).filter(Boolean).join('\n\n'); }
function sourcePage(item = {}) { return Number(item?.source?.page_number || 0); }
function resolveSource(item = {}) {
  const declared = validateDeclaredSource(state.raw?.pages || [], item);
  if (!declared) return null;
  const rendered = renderMarkdown(state.raw.pages[declared.pageNumber - 1].markdown || state.raw.pages[declared.pageNumber - 1].content || '');
  const highlightQuote = markdownLabel(declared.quote);
  return { ...declared, highlightQuote, canHighlight: Boolean(highlightQuote) && plain(rendered).includes(highlightQuote) };
}
function sourceIsUsable(item = {}) { return Boolean(resolveSource(item)); }
function labelFor(kind) { return ({ authors: 'Authors', affiliations: 'Affiliations', abstract: 'Abstract', article: 'Article', keywords: 'Keywords', references: 'References', tables: 'Tables', figures: 'Figures' })[kind] || kind; }
function countUnit(kind, value) { const forms = { authors: ['author', 'authors'], affiliations: ['affiliation', 'affiliations'], abstract: ['word', 'words'], article: ['word', 'words'], keywords: ['keyword', 'keywords'], references: ['reference', 'references'], tables: ['table', 'tables'], figures: ['figure', 'figures'] }; const [singular, plural] = forms[kind] || ['item', 'items']; return Number(value) === 1 ? singular : plural; }
function recordCountReady(kind, value) { recordRuntime(`${labelFor(kind)} count ready`, `${value} ${countUnit(kind, value)} returned.`, `count:${kind}`); }
function recordSourceLinksReady(kind) { const items = sourceItems(kind); const confirmed = items.filter(sourceIsUsable).length; const detail = items.length ? `${confirmed}/${items.length} exact HTML source links confirmed.` : 'No source-linked items were returned.'; recordRuntime(`${labelFor(kind)} source links ready`, detail, `links:${kind}`); }
function announceHtmlReady() { htmlMode.classList.remove('is-html-ready'); void htmlMode.offsetWidth; htmlMode.classList.add('is-html-ready'); }
function appendMarkdown(content, value = '') { renderMarkdown(value).split(/\n{2,}/).filter(Boolean).forEach((block) => { const heading = /^(#{1,6})\s+([\s\S]+)$/.exec(block.trim()); const node = document.createElement(heading ? `h${Math.min(6, heading[1].length + 1)}` : 'p'); node.className = heading ? 'ocr-markdown-heading' : 'ocr-markdown-paragraph'; node.innerHTML = inlineMarkdown(heading ? heading[2] : block); content.append(node); }); }
function safeTable(tableHtml = '') { const allowed = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'B', 'STRONG', 'I', 'EM', 'SUB', 'SUP', 'BR']); const source = new DOMParser().parseFromString(tableHtml, 'text/html').querySelector('table'); if (!source) return null; const copy = (node) => { if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue); if (!allowed.has(node.nodeName)) return document.createDocumentFragment(); const clone = document.createElement(node.nodeName.toLowerCase()); if (['TD', 'TH'].includes(node.nodeName)) ['colspan', 'rowspan'].forEach((name) => { const value = Number(node.getAttribute(name)); if (Number.isInteger(value) && value > 0) clone.setAttribute(name, String(value)); }); node.childNodes.forEach((child) => clone.append(copy(child))); return clone; }; return copy(source); }
function appendTables(content, tables = []) { tables.forEach((table, index) => { const wrapper = document.createElement('div'); wrapper.className = 'ocr-table-wrap'; const label = document.createElement('div'); label.className = 'ocr-display-label'; label.textContent = `Table ${index + 1}`; const responsive = document.createElement('div'); responsive.className = 'table-responsive'; const rendered = safeTable(table.content); if (!rendered) return; rendered.classList.add('table', 'table-sm', 'align-middle', 'mb-0'); responsive.append(rendered); wrapper.append(label, responsive); content.append(wrapper); }); }
async function renderFigureCrop(canvas, image, pageIndex, dimensions) { if (!state.pdf || !dimensions?.width || !dimensions?.height) return; const page = await state.pdf.getPage(pageIndex + 1); const viewport = page.getViewport({ scale: 1.3 }); const source = document.createElement('canvas'); source.width = Math.ceil(viewport.width); source.height = Math.ceil(viewport.height); await page.render({ canvasContext: source.getContext('2d', { alpha: false }), viewport }).promise; const scaleX = viewport.width / dimensions.width; const scaleY = viewport.height / dimensions.height; const x = Math.max(0, Math.floor(image.top_left_x * scaleX)); const y = Math.max(0, Math.floor(image.top_left_y * scaleY)); const width = Math.min(source.width - x, Math.ceil((image.bottom_right_x - image.top_left_x) * scaleX)); const height = Math.min(source.height - y, Math.ceil((image.bottom_right_y - image.top_left_y) * scaleY)); canvas.width = width; canvas.height = height; canvas.getContext('2d', { alpha: false }).drawImage(source, x, y, width, height, 0, 0, width, height); }
function imageDataUrl(value = '') { const source = String(value).trim(); return source.startsWith('data:image/') ? source : `data:image/jpeg;base64,${source}`; }
function appendFigures(content, images = [], pageIndex = 0, dimensions = null) { images.forEach((image, index) => { const figure = document.createElement('figure'); figure.className = 'ocr-figure'; const label = document.createElement('figcaption'); label.className = 'ocr-display-label'; label.textContent = `Figure ${index + 1}`; figure.append(label); if (image.image_base64) { const img = document.createElement('img'); img.className = 'img-fluid'; img.src = imageDataUrl(image.image_base64); img.alt = `Figure ${index + 1} from source page ${pageIndex + 1}`; figure.append(img); } else { const canvas = document.createElement('canvas'); canvas.className = 'ocr-figure-canvas'; canvas.setAttribute('aria-label', `Figure ${index + 1} from source page ${pageIndex + 1}`); figure.append(canvas); renderFigureCrop(canvas, image, pageIndex, dimensions).catch(() => { canvas.replaceWith(document.createTextNode('Figure preview unavailable.')); }); } content.append(figure); }); }
function resolvedReferencesByPage() {
  const references = state.annotations.references?.references || [];
  if (!references.length) return new Map();
  const resolved = references.map((reference) => ({ reference, source: resolveSource(reference) }));
  if (resolved.some(({ source }) => !source)) return new Map();
  return resolved.reduce((groups, { reference, source }) => { const entries = groups.get(source.pageNumber) || []; entries.push(reference); groups.set(source.pageNumber, entries); return groups; }, new Map());
}
function appendAnnotatedReferences(content, references = [], pageHasReferenceHeading = false) {
  if (!references.length) return;
  const list = document.createElement('ol'); list.className = 'ocr-reference-list'; list.start = Number(references[0].number || 1);
  if (!pageHasReferenceHeading) list.setAttribute('aria-label', 'References');
  references.forEach((reference) => { const item = document.createElement('li'); item.dataset.referenceNumber = String(reference.number || ''); item.dataset.referenceText = plain(reference.text).replace(/\s+/g, ' ').trim(); item.textContent = reference.text; list.append(item); });
  content.append(list);
}
function showHtml(pages = []) { const scroll = el('.html-scroll')?.scrollTop || 0; const referencesByPage = resolvedReferencesByPage(); htmlDocument.replaceChildren(); pages.forEach((page, index) => { const section = document.createElement('section'); section.className = 'ocr-page'; section.dataset.page = String(index + 1); const label = document.createElement('span'); label.className = 'ocr-page-label'; label.textContent = `Page ${index + 1}`; const content = document.createElement('div'); const pageNumber = index + 1; const annotatedReferences = referencesByPage.get(pageNumber) || []; const markdown = page.markdown || page.content || (page.blocks || []).map((block) => block.content || '').join('\n\n'); const referenceHeading = /(^#{1,6}\s+References\s*$)/im.exec(markdown); if (annotatedReferences.length && referenceHeading) appendMarkdown(content, markdown.slice(0, referenceHeading.index + referenceHeading[0].length)); else if (!annotatedReferences.length) appendMarkdown(content, markdown); appendTables(content, page.tables); appendFigures(content, page.images, index, page.dimensions); appendAnnotatedReferences(content, annotatedReferences, Boolean(referenceHeading)); section.append(label, content); htmlDocument.append(section); }); if (pages.length) { announceHtmlReady(); requestAnimationFrame(() => { const host = el('.html-scroll'); if (host) host.scrollTop = scroll; }); } }
function scrollPdfToPage(pageNumber, attempts = 0) { const target = el(`.pdf-page[data-page="${pageNumber}"]`); if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('pdf-page-target'); window.setTimeout(() => target?.classList.remove('pdf-page-target'), 1400); return; } if (state.pdf && attempts < 20) { window.setTimeout(() => scrollPdfToPage(pageNumber, attempts + 1), 100); return; } setMode('html'); el(`.ocr-page[data-page="${pageNumber}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function jumpToTocEntry(entry) { const pageNumber = sourcePage(entry); if (!pageNumber) return; if (!pdfPane.classList.contains('d-none')) { scrollPdfToPage(pageNumber); return; } const target = el(`.ocr-page[data-page="${pageNumber}"]`); clearSourceHighlight(); target?.scrollIntoView({ behavior: 'smooth', block: 'start' }); highlightExactQuote(target, entry.heading); }
function showToc(entries = []) { toc.replaceChildren(); if (!entries.length) { toc.textContent = 'No section headings were returned.'; return; } entries.forEach((entry) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'toc-button'; button.style.paddingLeft = `${.45 + Math.max(0, Number(entry.level || 1) - 1) * .7}rem`; button.textContent = entry.tocLabel || entry.heading; button.addEventListener('click', () => jumpToTocEntry(entry)); toc.append(button); }); }
function labelFirstTitle(entries = []) { let labelled = false; return entries.map((entry) => { if (!entry.isTitle || labelled) return entry; labelled = true; return { ...entry, tocLabel: 'Title' }; }); }
function rawBlockEntries(pages = [], types = []) { const entries = []; pages.forEach((page, pageIndex) => (page.blocks || []).forEach((block) => { const type = String(block.type || '').toLowerCase(); if (types.includes(type)) entries.push({ heading: headingLabel(block.content), isTitle: type === 'title', level: 1, source: { page_number: pageIndex + 1 } }); })); return labelFirstTitle(entries.filter((entry) => entry.heading)); }
function rawMarkdownHeadingEntries(pages = []) { return labelFirstTitle(pages.flatMap((page, pageIndex) => String(page.markdown || '').split(/\r?\n/).flatMap((line) => { const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line); if (!match) return []; return [{ heading: match[2], isTitle: match[1].length === 1, level: match[1].length, source: { page_number: pageIndex + 1 } }]; }))); }
function showRawOcr(raw = {}) { state.raw = raw; const pages = raw.pages || []; const typedEntries = rawBlockEntries(pages, ['title', 'heading']); const tocEntries = typedEntries.length ? typedEntries : rawMarkdownHeadingEntries(pages); const tableCount = pages.reduce((sum, page) => sum + (page.tables || []).length, 0); const figureCount = rawBlockEntries(pages, ['figure', 'image']).length; showHtml(pages); showToc(tocEntries); setCount('tables', String(tableCount)); setCount('figures', String(figureCount)); recordRuntime('Table of contents ready', `${tocEntries.length} OCR headings returned.`, 'toc'); recordCountReady('tables', tableCount); recordCountReady('figures', figureCount); note.textContent = 'OCR source is ready. Additional counts are being prepared.'; fileName.textContent = `${raw.fileName} · OCR source ready in ${(Number(raw.elapsedMs || 0) / 1000).toFixed(1)} s`; }
function refreshOpenDetails(kinds = []) { if (kinds.includes(state.openDetailKind)) openDetails(state.openDetailKind); }
function showFrontMatterCounts(annotation = {}) { state.annotations['front-matter'] = annotation; state.annotationStatus['front-matter'] = 'ready'; const values = [['authors', annotation.authors?.length || 0], ['affiliations', annotation.affiliations?.length || 0], ['abstract', annotation.abstract?.word_count || 0], ['keywords', annotation.keywords?.length || 0]]; values.forEach(([kind, value]) => { setCount(kind, String(value)); recordCountReady(kind, value); recordSourceLinksReady(kind); }); refreshOpenDetails(values.map(([kind]) => kind)); }
function showBodyCounts(annotation = {}) { state.annotations.body = annotation; state.annotationStatus.body = 'ready'; const articleWords = (annotation.sections || []).reduce((sum, section) => sum + Number(section.word_count || 0), 0); const displayItems = annotation.display_items || []; const tableCount = displayItems.filter((item) => item.kind === 'table').length; const figureCount = displayItems.filter((item) => item.kind === 'figure').length; setCount('article', String(articleWords)); setCount('tables', String(tableCount)); setCount('figures', String(figureCount)); recordCountReady('article', articleWords); recordCountReady('tables', tableCount); recordCountReady('figures', figureCount); ['article', 'tables', 'figures'].forEach(recordSourceLinksReady); refreshOpenDetails(['article', 'tables', 'figures']); }
function showReferenceCounts(annotation = {}) { state.annotations.references = annotation; state.annotationStatus.references = 'ready'; const count = annotation.references?.length || 0; setCount('references', String(count)); recordCountReady('references', count); recordSourceLinksReady('references'); showHtml(state.raw?.pages || []); refreshOpenDetails(['references']); }
function markPassUnavailable(name, kinds) { state.annotationStatus[name] = 'unavailable'; kinds.forEach((kind) => setCount(kind)); refreshOpenDetails(kinds); }
function request(path, payload) { return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).then(async (response) => ({ response, result: await response.json() })); }
function closeDetails() { state.openDetailKind = ''; const panel = el('#detailsPanel'); panel.classList.remove('is-open'); panel.setAttribute('aria-hidden', 'true'); }
function sourceItems(kind) { const front = state.annotations['front-matter'] || {}; const body = state.annotations.body || {}; const refs = state.annotations.references || {}; if (['authors', 'affiliations', 'keywords'].includes(kind)) return front[kind] || []; if (kind === 'abstract') return front.abstract?.text ? [front.abstract] : []; if (kind === 'article') return body.sections || []; if (kind === 'references') return refs.references || []; if (kind === 'tables' || kind === 'figures') return (body.display_items || []).filter((item) => item.kind === kind.slice(0, -1)); return []; }
function detailText(item, kind) { if (kind === 'article') return item.heading ? `${item.heading}\n${item.text}` : item.text; if (kind === 'references') return item.text; if (kind === 'tables' || kind === 'figures') return item.label; return item.text; }
function detailPass(kind) { if (['authors', 'affiliations', 'abstract', 'keywords'].includes(kind)) return 'front-matter'; if (['article', 'tables', 'figures'].includes(kind)) return 'body'; if (kind === 'references') return 'references'; return null; }
function appendDetailStatus(container, text, pending = false) { const status = document.createElement('div'); status.className = `detail-link-status small text-secondary mt-2 d-flex align-items-center gap-2${pending ? ' is-pending' : ''}`; if (pending) status.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>'; const message = document.createElement('span'); message.textContent = text; status.append(message); container.append(status); }
function clearSourceHighlight() { document.querySelectorAll('.source-target-highlight').forEach((mark) => { const parent = mark.parentNode; parent.replaceChild(document.createTextNode(mark.textContent), mark); parent.normalize(); }); document.querySelectorAll('.ocr-reference-target, .ocr-page-source-target').forEach((target) => target.classList.remove('ocr-reference-target', 'ocr-page-source-target')); }
function highlightExactQuote(container, quote) { if (!quote) return false; const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { const offset = node.nodeValue.indexOf(quote); if (offset < 0) continue; const fragment = document.createDocumentFragment(); fragment.append(node.nodeValue.slice(0, offset)); const mark = document.createElement('mark'); mark.className = 'source-target-highlight'; mark.textContent = quote; fragment.append(mark, node.nodeValue.slice(offset + quote.length)); node.parentNode.replaceChild(fragment, node); return true; } return false; }
function findReferenceTarget(item, pageNumber) { const entries = [...document.querySelectorAll(`.ocr-page[data-page="${pageNumber}"] .ocr-reference-list li`)]; const number = String(item?.number || ''); if (number) { const numbered = entries.find((entry) => entry.dataset.referenceNumber === number); if (numbered) return numbered; } const text = plain(item?.text || '').replace(/\s+/g, ' ').trim(); return entries.find((entry) => entry.dataset.referenceText === text) || entries.find((entry) => text && entry.dataset.referenceText.includes(text)); }
function jumpToSource(item, kind = '') { const source = resolveSource(item); if (!source) return; setMode('html'); clearSourceHighlight(); const referenceTarget = kind === 'references' ? findReferenceTarget(item, source.pageNumber) : null; if (referenceTarget) { referenceTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); referenceTarget.classList.add('ocr-reference-target'); window.setTimeout(() => referenceTarget?.classList.remove('ocr-reference-target'), 1800); return; } const target = el(`.ocr-page[data-page="${source.pageNumber}"]`); target?.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (source.canHighlight) highlightExactQuote(target, source.highlightQuote); if (!document.querySelector('.source-target-highlight')) { target?.classList.add('ocr-page-source-target'); window.setTimeout(() => target?.classList.remove('ocr-page-source-target'), 1400); } }
function openDetails(kind) { state.openDetailKind = kind; const tile = el(`[data-count="${kind}"]`); const count = tile?.querySelector('strong')?.textContent || '—'; const items = sourceItems(kind); const pass = detailPass(kind); const passPending = pass && state.annotationStatus[pass] === 'pending'; const body = el('#detailsPanelBody'); body.replaceChildren(); const heading = document.createElement('h2'); heading.className = 'h6 mb-3 pb-2 border-bottom'; heading.textContent = `${kind[0].toUpperCase()}${kind.slice(1)}`; body.append(heading); if (tile?.classList.contains('is-loading')) { const pending = document.createElement('div'); pending.className = 'details-pending d-flex align-items-center gap-3'; pending.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><div><div class="small fw-semibold text-body">Still preparing these details</div><div class="small text-secondary mt-1">The manuscript is ready. Results and source links will appear here shortly.</div></div>'; body.append(pending); } else { const summary = document.createElement('div'); summary.className = 'alert alert-light border py-2 px-3 small mb-3'; summary.textContent = `${count} returned from the current source-grounded document map.`; body.append(summary); if (!items.length) { const source = document.createElement('div'); source.className = 'detail-source-surface'; source.textContent = passPending ? 'Source links are being prepared.' : 'No item details were returned for this result.'; body.append(source); } else { const list = document.createElement('div'); list.className = 'vstack gap-2'; items.forEach((item) => { const source = resolveSource(item); const linked = Boolean(source); const row = document.createElement(linked ? 'button' : 'div'); if (linked) row.type = 'button'; row.className = `detail-source-surface ${linked ? 'detail-jump border-0 text-start' : 'detail-source-unavailable'}`; const text = document.createElement('div'); text.className = 'detail-source-text'; text.textContent = detailText(item, kind); row.append(text); if (source) { appendDetailStatus(row, source.canHighlight ? 'Open source in HTML' : 'Open source page in HTML'); row.addEventListener('click', () => jumpToSource(item, kind)); } else appendDetailStatus(row, 'This item is available, but its exact source link could not be confirmed.'); list.append(row); }); body.append(list); } } const panel = el('#detailsPanel'); panel.classList.add('is-open'); panel.setAttribute('aria-hidden', 'false'); }
function applyPaneWidths() { reader.style.setProperty('--toc-width', `${state.tocWidth}px`); reader.style.setProperty('--counts-width', `${state.countsWidth}px`); }
function schedulePdfRender() { if (!state.pdf) return; window.clearTimeout(state.pdfResizeTimer); state.pdfResizeTimer = window.setTimeout(() => { renderPdfPages(); }, 90); }
async function renderPdfPages() {
  const pdf = state.pdf; const token = ++state.pdfRenderToken;
  if (!pdf) return;
  const availableWidth = Math.max(320, el('.pdf-scroll').clientWidth - 34);
  pdfCanvasHost.replaceChildren();
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    if (token !== state.pdfRenderToken) return;
    const initialViewport = page.getViewport({ scale: 1 });
    const scale = availableWidth / initialViewport.width;
    const viewport = page.getViewport({ scale });
    const pageContainer = document.createElement('div'); pageContainer.className = 'pdf-page'; pageContainer.dataset.page = String(pageNumber);
    const canvas = document.createElement('canvas'); const context = canvas.getContext('2d', { alpha: false });
    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.className = 'pdf-page-canvas'; canvas.width = Math.floor(viewport.width * deviceScale); canvas.height = Math.floor(viewport.height * deviceScale);
    pageContainer.append(canvas); pdfCanvasHost.append(pageContainer);
    await page.render({ canvasContext: context, viewport, transform: deviceScale === 1 ? null : [deviceScale, 0, 0, deviceScale, 0, 0] }).promise;
  }
}
async function loadPdf(data) {
  const task = getDocument({ data: new Uint8Array(data) });
  state.pdf = await task.promise;
  pdfEmpty.classList.add('d-none'); pdfCanvasHost.classList.remove('d-none');
  if (state.raw?.pages?.length) showHtml(state.raw.pages);
  await renderPdfPages();
}
function beginResize(side, event) { if (reader.classList.contains(`${side}-collapsed`)) return; state.resizing = side; reader.classList.add('is-resizing'); event.preventDefault(); }
function moveResize(event) { if (!state.resizing) return; const bounds = reader.getBoundingClientRect(); if (state.resizing === 'toc') state.tocWidth = Math.max(176, Math.min(480, event.clientX - bounds.left)); else state.countsWidth = Math.max(330, Math.min(620, bounds.right - event.clientX)); applyPaneWidths(); schedulePdfRender(); }
function endResize() { state.resizing = null; reader.classList.remove('is-resizing'); schedulePdfRender(); }
async function upload(file) {
  if (file.type !== 'application/pdf') { fileName.textContent = 'Choose a PDF file.'; return; }
  if (file.size > 4 * 1024 * 1024) { fileName.textContent = 'This deployment accepts PDFs up to 4 MB.'; return; }
  showReader(); startRuntime(); state.annotations = { 'front-matter': null, body: null, references: null }; state.annotationStatus = { 'front-matter': 'idle', body: 'idle', references: 'idle' }; recordRuntime('Upload started', file.name); fileName.textContent = file.name; setMode('pdf'); showProgress();
  const pdfBytes = await file.arrayBuffer();
  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
  loadPdf(pdfBytes.slice(0)).catch(() => { pdfEmpty.classList.remove('d-none'); pdfEmpty.querySelector('p').textContent = 'The PDF preview could not be rendered.'; });
  const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
  const payload = JSON.stringify({ fileName: file.name, base64 });
  let rawResult; try { rawResult = await request('/api/ocr/raw', payload); } catch { recordRuntime('Raw OCR unavailable'); toc.textContent = 'Document structure is unavailable.'; return; }
  if (!rawResult.response.ok) { recordRuntime('Raw OCR unavailable', rawResult.result.error || 'Request failed.'); toc.textContent = 'Document structure is unavailable.'; note.textContent = 'The OCR source could not be returned.'; return; }
  recordRuntime('Raw OCR ready', `${rawResult.result.pages.length} pages in ${(Number(rawResult.result.elapsedMs || 0) / 1000).toFixed(1)} s.`);
  showRawOcr(rawResult.result);
  const annotations = { 'front-matter': null, body: null, references: null };
  const jobs = [['front-matter', ['authors', 'affiliations', 'abstract', 'keywords'], showFrontMatterCounts], ['body', ['article'], showBodyCounts], ['references', ['references'], showReferenceCounts]].map(([name, kinds, apply]) => { state.annotationStatus[name] = 'pending'; return request(`/api/ocr/annotate/${name}`, payload).then(({ response, result }) => { if (response.ok) { annotations[name] = result.annotation; apply(result.annotation); recordRuntime(`${name.replace('-', ' ')} ready`, `${(Number(result.elapsedMs || 0) / 1000).toFixed(1)} s.`); fileName.textContent = `${result.fileName} · ${name.replace('-', ' ')} ready in ${(Number(result.elapsedMs || 0) / 1000).toFixed(1)} s`; } else { recordRuntime(`${name.replace('-', ' ')} unavailable`, result.error || 'Request failed.'); markPassUnavailable(name, kinds); } }).catch(() => { recordRuntime(`${name.replace('-', ' ')} unavailable`); markPassUnavailable(name, kinds); }); });
  Promise.allSettled(jobs).then(async () => { try { const id = crypto.randomUUID(); await saveReview({ id, fileName: file.name, savedAt: new Date().toISOString(), pdfBlob, raw: rawResult.result, annotations }); recordRuntime('Review stored locally', 'Available from the home page without another OCR request.'); } catch { recordRuntime('Local review storage unavailable', 'This review remains open but could not be saved in this browser.'); } });
}
async function openStoredReview(stored, pdfData, detail) {
  startRuntime(); recordRuntime('Stored review opened', 'Loading locally saved OCR and annotation results.');
  state.annotations = { 'front-matter': null, body: null, references: null };
  state.annotationStatus = { 'front-matter': 'idle', body: 'idle', references: 'idle' };
  showReader();
  setMode('pdf');
  showProgress();
  loadPdf(pdfData);
  recordRuntime('Stored OCR ready', `${stored.raw.pages.length} pages loaded without an API request.`);
  showRawOcr(stored.raw);
  showFrontMatterCounts(stored.annotations['front-matter']);
  showBodyCounts(stored.annotations.body);
  showReferenceCounts(stored.annotations.references);
  note.textContent = 'Stored OCR and source-linked results are loaded locally.';
  fileName.textContent = `${stored.fileName} · ${detail}`;
  recordRuntime('Stored annotation ready', 'Front matter, body, and references loaded locally.');
}
async function loadStoredReview(id) {
  if (!['medrxiv', 'chemrxiv', 'eartharxiv', 'researchsquare', 'psyarxiv', 'oraktx'].includes(id)) return;
  const [storedResponse, pdfResponse] = await Promise.all([fetch(`/data/stored/${id}.json`), fetch(`/data/stored/${id}.pdf`)]);
  if (!storedResponse.ok || !pdfResponse.ok) throw new Error('Stored review is unavailable.');
  await openStoredReview(await storedResponse.json(), await pdfResponse.arrayBuffer(), 'stored example');
}
async function loadBrowserReview(id) {
  const stored = await loadReview(id);
  if (!stored?.pdfBlob) throw new Error('Stored review is unavailable in this browser.');
  await openStoredReview(stored, await stored.pdfBlob.arrayBuffer(), 'stored review');
}
async function openHomeReview(value) {
  try {
    if (value.startsWith('example:')) await loadStoredReview(value.slice('example:'.length));
    else await loadBrowserReview(value);
  } catch {
    showHome();
    const list = el('#exampleManuscriptList');
    if (list) {
      const message = document.createElement('div');
      message.className = 'alert alert-warning small mb-0 w-100';
      message.textContent = 'This stored example could not be loaded. Reload the page and try again.';
      list.prepend(message);
    }
  }
}
function enableLocalLiveReload() {
  if (!['127.0.0.1', 'localhost'].includes(window.location.hostname)) return;
  let revision = null;
  window.setInterval(async () => {
    try {
      const response = await fetch('/__deskreview_dev_revision', { cache: 'no-store' });
      const next = (await response.json()).revision;
      if (revision && next && revision !== next && !document.hidden) window.location.reload();
      revision = next;
    } catch { /* The local server may be restarting. */ }
  }, 1500);
}

input.addEventListener('change', async () => { const file = input.files?.[0]; if (!file) return; try { await upload(file); } catch { toc.textContent = 'The document could not be processed.'; } finally { input.value = ''; } });
pdfMode.addEventListener('click', () => setMode('pdf')); htmlMode.addEventListener('click', () => setMode('html')); htmlMode.addEventListener('animationend', () => htmlMode.classList.remove('is-html-ready'));
el('#manuscriptSearchToggleButton').addEventListener('click', () => { const control = el('#manuscriptSearchControl'); const open = control.classList.toggle('is-open'); el('#manuscriptSearchToggleButton').setAttribute('aria-expanded', String(open)); if (open) el('#pdfSearchInput').focus(); });
el('#tocToggleButton').addEventListener('click', () => { const collapsed = reader.classList.toggle('toc-collapsed'); el('#tocToggleButton').setAttribute('aria-expanded', String(!collapsed)); });
el('#countsToggleButton').addEventListener('click', () => { const collapsed = reader.classList.toggle('counts-collapsed'); el('#countsToggleButton').setAttribute('aria-expanded', String(!collapsed)); el('#countsToggleButton i').className = collapsed ? 'bi bi-layout-sidebar-reverse' : 'bi bi-x-lg'; });
el('#tocSplitter').addEventListener('pointerdown', (event) => beginResize('toc', event)); el('#countsSplitter').addEventListener('pointerdown', (event) => beginResize('counts', event)); window.addEventListener('pointermove', moveResize); window.addEventListener('pointerup', endResize);
document.querySelectorAll('.count-tile').forEach((tile) => tile.addEventListener('click', () => openDetails(tile.dataset.count))); el('#detailsPanelClose').addEventListener('click', closeDetails);
document.querySelectorAll('[data-open-guideline]').forEach((button) => button.addEventListener('click', () => { el('#guidelineDetailName').textContent = button.dataset.openGuideline; el('#guidelineDetailSlider').classList.add('is-open'); })); el('#closeGuidelineDetailSlider').addEventListener('click', () => el('#guidelineDetailSlider').classList.remove('is-open'));
el('#runtimeSummaryModal').addEventListener('show.bs.modal', renderRuntimeSummary);
el('#homeDemoModal').addEventListener('hidden.bs.modal', () => { const video = el('#homeDemoVideo'); video.pause(); video.currentTime = 0; });
applyPaneWidths();
new ResizeObserver(schedulePdfRender).observe(el('#centerPane'));
const storedReview = new URLSearchParams(window.location.search).get('review');
await initHome({ onUpload: upload, onOpenReview: openHomeReview });
if (storedReview) openHomeReview(`example:${storedReview}`);
enableLocalLiveReload();
