import { getDocument, GlobalWorkerOptions, TextLayer } from '/vendor/pdfjs/build/pdf.mjs';
import renderMathInElement from '/vendor/katex/contrib/auto-render.mjs';
import { initHome, refreshHome } from '/home.js';
import { loadReview, saveReview } from '/review-store.js';
import { validateDeclaredSource } from '/core/source-anchor.js';
import { createRuntimeLog, runtimeFlowModel } from '/app/runtime-log.js';
import { headingLabel, inlineMarkdown, markdownLabel, plain, renderMarkdown } from '/app/markdown.js';
import { projectAnnotation } from '/app/annotation-projection.js';
import { renderSchemaOverview } from '/app/schema-browser.js';
import { googleScholarUrl } from '/core/author-profiles.js';
import { projectAffiliationLinkage } from '/core/affiliation-linkage.js';
import { applySourceLinks, projectAnnotationChunks } from '/core/annotation-stages.js';
import { annotationManifestIsComplete, annotationManifestSummary, createAnnotationRunManifest, markAnnotationRange } from '/core/annotation-manifest.js';
import { wordCountProvenanceFromBlocks } from '/core/article-word-count.js';
import { ocrMarkdownForPresentation } from '/core/ocr-presentation.js';
import { documentAnnotationSourcePageMap } from '/core/document-annotation.js';
import {
  MIN_REFERENCE_TEXT_COVERAGE,
  referenceAnnotationFormat,
  referenceAnnotationPages,
  referenceAnnotationPrompt,
  referenceAnnotationPromptInstructions,
  referenceBlocksFromRawPages
} from '/core/reference-annotation.js';
import { applyReferenceLinks } from '/core/reference-links-contract.js';
import { bindCitationAnnotationRanges, bodyCitationBlockRanges, citationAnnotationFormat, citationAnnotationPrompt, citationAnnotationPromptInstructions, MAX_CITATION_REQUESTS_PER_MANUSCRIPT } from '/core/citation-annotation.js';

GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.mjs';

const el = (selector) => document.querySelector(selector);
const categoryKinds = ['authors', 'affiliations', 'abstract', 'article', 'keywords', 'references', 'tables', 'figures'];
const categoryLabels = { authors: 'Authors', affiliations: 'Affiliations', abstract: 'Abstract', article: 'Article', keywords: 'Keywords', references: 'References', tables: 'Tables', figures: 'Figures' };
function initialCategoryStates(value = 'waiting') { return Object.fromEntries(categoryKinds.map((kind) => [kind, value])); }
const state = { tocWidth: 288, countsWidth: 448, resizing: null, raw: null, openDetailKind: '', pdf: null, pdfRenderToken: 0, pdfResizeTimer: null, search: { query: '', matches: [], index: -1 }, annotations: { 'front-matter': null, body: null, references: null }, annotationChunks: [], annotationCandidates: null, referenceInventory: { status: 'idle', pages: [], blockCount: 0, references: [], coverage: null, issues: [], error: '' }, citationExtraction: { status: 'idle', ranges: [], candidates: [] }, documentQna: { references: null, displays: [] }, annotationStatus: { 'front-matter': 'idle', body: 'idle', references: 'idle' }, annotationCoverage: { ranges: [], completed: [], failed: [] }, categoryStates: initialCategoryStates(), sourceLinksStatus: 'idle', sourceLinksByKind: { tables: 'idle', figures: 'idle' }, referenceLinksStatus: 'idle', authorProfiles: { status: 'idle', authors: [] }, authorProfileToken: 0, affiliationFilter: 'all', currentReview: null, preservingRuntimeSnapshot: false };
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
function showReader() { homeView.classList.add('d-none'); reader.classList.remove('d-none'); triggerReaderReveal(); }
function triggerReaderReveal() { reader.classList.remove('reader-reveal'); void reader.offsetWidth; reader.classList.add('reader-reveal'); }
async function openStoredReviewsLibrary() {
  showReader();
  await refreshHome({ onOpenReview: openHomeReview });
  window.bootstrap?.Modal.getOrCreateInstance(el('#storedReviewsModal'))?.show();
}

function startRuntime(snapshot = null) { if (Array.isArray(snapshot) && snapshot.length) runtime.restore(snapshot); else runtime.reset(); }
function recordRuntime(label, detail = '', key = label, data = null) {
  runtime.record(label, detail, key, data);
  if (el('#annotationContractModal')?.classList.contains('show') && el('#runtimeSummaryPane')?.classList.contains('active')) renderRuntimeSummary();
}
function persistAuthorProfiles(profiles) { if (!state.currentReview) return; state.currentReview.authorProfiles = profiles; saveReview(state.currentReview).catch(() => {}); }
function runtimeTime(elapsedMs) { return Number.isFinite(elapsedMs) ? `+${(elapsedMs / 1000).toFixed(1)} s` : '—'; }
function runtimeStateLabel(value) { return { ready: 'Ready', pending: 'In progress', unavailable: 'Unavailable', blocked: 'Blocked', waiting: 'No event yet' }[value] || 'No event yet'; }
function runtimeStatus(value, elapsedMs, detail = '') {
  const wrap = document.createElement('span');
  wrap.className = 'runtime-status d-inline-flex align-items-center gap-2';
  wrap.dataset.runtimeState = value;
  if (detail) wrap.title = detail;
  const dot = document.createElement('span');
  dot.className = 'runtime-status-dot flex-shrink-0';
  dot.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.className = 'small';
  text.textContent = `${runtimeStateLabel(value)}${Number.isFinite(elapsedMs) ? ` · ${runtimeTime(elapsedMs)}` : ''}`;
  wrap.append(dot, text);
  return wrap;
}
function renderRuntimeSummary() {
  const events = runtime.entries();
  const flow = runtimeFlowModel(events);
  const metrics = el('#runtimeSummaryMetrics');
  const diagram = el('#runtimeFlowDiagram');
  const categories = el('#runtimeCategoryFlow');
  const eventLog = el('#runtimeSummarySections');
  metrics.replaceChildren();
  diagram.replaceChildren();
  categories.replaceChildren();
  eventLog.replaceChildren();
  [
    ['Elapsed', runtimeTime(flow.elapsedMs)],
    ['Counts ready', `${flow.countsReady}/${flow.resultCount}`],
    ['Source links ready', `${flow.linksReady}/${flow.resultCount}`]
  ].forEach(([label, value]) => {
    const metric = document.createElement('div');
    metric.className = 'border rounded-3 bg-body px-3 py-2';
    const valueNode = document.createElement('div');
    valueNode.className = 'small fw-semibold';
    valueNode.textContent = value;
    const labelNode = document.createElement('div');
    labelNode.className = 'small text-secondary';
    labelNode.textContent = label;
    metric.append(valueNode, labelNode);
    metrics.append(metric);
  });
  flow.stages.forEach((item) => {
    const node = document.createElement('div');
    node.className = 'runtime-flow-stage position-relative border rounded-3 bg-body p-3';
    node.dataset.runtimeState = item.state;
    const top = document.createElement('div');
    top.className = 'd-flex align-items-center justify-content-between gap-2 mb-2';
    const icon = document.createElement('i');
    icon.className = `bi ${item.icon} text-secondary`;
    icon.setAttribute('aria-hidden', 'true');
    top.append(icon, runtimeStatus(item.state, null, item.detail));
    const label = document.createElement('div');
    label.className = 'small fw-semibold';
    label.textContent = item.label;
    const time = document.createElement('div');
    time.className = 'small text-secondary mt-1';
    time.textContent = runtimeTime(item.elapsedMs);
    node.append(top, label, time);
    diagram.append(node);
  });
  const table = document.createElement('table');
  table.className = 'table table-sm align-middle mb-0 runtime-result-table';
  const thead = document.createElement('thead');
  thead.className = 'table-light';
  thead.innerHTML = '<tr><th scope="col">Result</th><th scope="col">Count</th><th scope="col">Item links</th><th scope="col">Additional check</th></tr>';
  const tbody = document.createElement('tbody');
  flow.results.forEach((result) => {
    const row = document.createElement('tr');
    row.dataset.runtimeResult = result.kind;
    const label = document.createElement('th');
    label.scope = 'row';
    label.className = 'fw-medium';
    const inspect = document.createElement('button');
    inspect.className = 'btn btn-sm btn-link link-body-emphasis text-decoration-none p-0 d-inline-flex align-items-center gap-2';
    inspect.type = 'button';
    inspect.dataset.bsToggle = 'collapse';
    inspect.dataset.bsTarget = `#runtime-dependencies-${result.kind}`;
    inspect.setAttribute('aria-expanded', 'false');
    inspect.setAttribute('aria-controls', `runtime-dependencies-${result.kind}`);
    const inspectLabel = document.createElement('span');
    inspectLabel.textContent = result.label;
    const inspectIcon = document.createElement('i');
    inspectIcon.className = 'bi bi-chevron-down small text-secondary runtime-dependency-chevron';
    inspectIcon.setAttribute('aria-hidden', 'true');
    inspect.append(inspectLabel, inspectIcon);
    label.append(inspect);
    const count = document.createElement('td');
    count.append(runtimeStatus(result.count.state, result.count.elapsedMs, result.count.detail));
    const links = document.createElement('td');
    links.append(runtimeStatus(result.links.state, result.links.elapsedMs, result.links.detail));
    const extra = document.createElement('td');
    if (result.extra) {
      const title = document.createElement('div');
      title.className = 'small text-secondary mb-1';
      title.textContent = result.extra.label;
      extra.append(title, runtimeStatus(result.extra.state, result.extra.elapsedMs, result.extra.detail));
    } else {
      extra.className = 'small text-secondary';
      extra.textContent = 'Not applicable';
    }
    row.append(label, count, links, extra);
    tbody.append(row);
    const dependencyRow = document.createElement('tr');
    dependencyRow.className = 'runtime-dependency-row';
    const dependencyCell = document.createElement('td');
    dependencyCell.colSpan = 4;
    dependencyCell.className = 'p-0 border-0';
    const collapse = document.createElement('div');
    collapse.className = 'collapse';
    collapse.id = `runtime-dependencies-${result.kind}`;
    const dependencyFlow = document.createElement('div');
    dependencyFlow.className = 'runtime-dependency-flow d-grid gap-2 bg-light-subtle border-bottom px-3 py-3';
    result.dependencies.forEach((dependency, index) => {
      const step = document.createElement('div');
      step.className = 'runtime-dependency-step position-relative border rounded-3 bg-body p-3';
      step.dataset.runtimeState = dependency.state;
      const stepNumber = document.createElement('div');
      stepNumber.className = 'small text-secondary mb-2';
      stepNumber.textContent = `Step ${index + 1}`;
      const stepTitle = document.createElement('div');
      stepTitle.className = 'small fw-semibold mb-2';
      stepTitle.textContent = dependency.label;
      const stepStatus = runtimeStatus(dependency.state, dependency.elapsedMs, dependency.detail);
      const stepDetail = document.createElement('div');
      stepDetail.className = 'small text-secondary mt-2';
      stepDetail.textContent = dependency.detail;
      step.append(stepNumber, stepTitle, stepStatus, stepDetail);
      dependencyFlow.append(step);
    });
    collapse.append(dependencyFlow);
    dependencyCell.append(collapse);
    dependencyRow.append(dependencyCell);
    tbody.append(dependencyRow);
  });
  table.append(thead, tbody);
  categories.append(table);
  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'text-secondary small';
    empty.textContent = 'No runtime data yet.';
    eventLog.append(empty);
    return;
  }
  events.forEach((event) => {
    const row = document.createElement('div');
    row.className = 'd-flex align-items-start justify-content-between gap-3 border-bottom pb-2';
    const text = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'small fw-semibold';
    title.textContent = event.label;
    const detail = document.createElement('div');
    detail.className = 'small text-secondary mt-1';
    detail.textContent = event.detail;
    text.append(title);
    if (event.detail) text.append(detail);
    const time = document.createElement('time');
    time.className = 'small text-secondary text-nowrap';
    time.textContent = runtimeTime(event.elapsedMs);
    row.append(text, time);
    eventLog.append(row);
  });
}
function renderAnnotationSourceScope() {
  const list = el('#annotationSourceScopeList');
  list.replaceChildren();
  const pages = state.raw?.pages || [];
  const rawBlocks = pages.flatMap((page, pageIndex) => (page.blocks || []).map((block, blockIndex) => ({
    pageIndex,
    blockIndex,
    id: `ocr-block-${pageIndex}-${blockIndex}`,
    type: String(block?.type || 'text'),
    content: String(block?.content || '')
  })));
  if (!pages.length) {
    const empty = document.createElement('div');
    empty.className = 'alert alert-light border small mb-0';
    empty.textContent = 'Open a manuscript to inspect its raw OCR source scope.';
    list.append(empty);
    return;
  }
  const table = document.createElement('table');
  table.className = 'table table-sm align-top mb-0';
  table.innerHTML = '<colgroup><col style="width: 72%"><col style="width: 28%"></colgroup><thead class="table-light"><tr><th scope="col" class="small fw-medium text-secondary">Raw OCR block</th><th scope="col" class="small fw-medium text-secondary">OCR details</th></tr></thead>';
  const tbody = document.createElement('tbody');
  rawBlocks.forEach((block) => {
    const row = document.createElement('tr');
    row.dataset.rawOcrBlock = block.id;
    const source = document.createElement('td');
    source.className = 'p-2';
    const raw = document.createElement('pre');
    raw.className = 'developer-contract-code border rounded-2 mb-0';
    raw.textContent = block.content || 'Empty OCR block';
    source.append(raw);
    const details = document.createElement('td');
    details.className = 'p-3';
    const page = document.createElement('div');
    page.className = 'small fw-semibold';
    page.textContent = `OCR page ${block.pageIndex + 1}`;
    const id = document.createElement('code');
    id.className = 'd-block small text-secondary mt-1 text-break';
    id.textContent = block.id;
    const type = document.createElement('span');
    type.className = 'badge text-bg-light border fw-normal mt-2';
    type.textContent = block.type.trim().toLowerCase() || 'text';
    details.append(page, id, type);
    row.append(source, details);
    tbody.append(row);
  });
  table.append(tbody);
  list.append(table);
}
function renderAnnotationReturnedData() {
  const container = el('#annotationReturnedData');
  if (!container) return;
  container.replaceChildren();
  const chunks = Array.isArray(state.annotationChunks) ? state.annotationChunks : [];
  if (!chunks.length) {
    const empty = document.createElement('div');
    empty.className = 'alert alert-light border small mb-0';
    empty.textContent = 'No Annotation contract response was retained for this review.';
    container.append(empty);
    return;
  }
  const sourceFromBlockKey = (value = '') => {
    const match = /^(ocr-block-(\d+)-(\d+))\s*::\s*([\s\S]*)$/.exec(String(value));
    return match ? { blockId: match[1], pageIndex: Number(match[2]), text: match[4] } : null;
  };
  const itemText = (item, fallback = '') => {
    if (typeof item === 'string') return sourceFromBlockKey(item)?.text || item;
    if (!item || typeof item !== 'object') return String(item ?? fallback);
    const visible = [item.label, item.item_exact_quote, item.heading, item.text, item.citation_text, item.exact_quote, item.source?.exact_quote]
      .find((value) => String(value || '').trim());
    if (visible) return String(visible);
    if (item.author_id || item.affiliation_id) return [item.author_id, item.affiliation_id].filter(Boolean).join(' → ');
    return sourceFromBlockKey(fallback)?.text || fallback || 'No display text returned';
  };
  const sourceFor = (item, fallback = '') => {
    const source = item && typeof item === 'object' ? item.source || {} : {};
    const fromKey = sourceFromBlockKey(fallback);
    const pageId = source.ocr_page_id || (Number.isInteger(fromKey?.pageIndex) ? `ocr-page-${fromKey.pageIndex}` : '');
    const blockId = source.ocr_block_id || fromKey?.blockId || '';
    const pageMatch = /^ocr-page-(\d+)$/.exec(String(pageId));
    return { page: pageMatch ? Number(pageMatch[1]) + 1 : null, blockId };
  };
  const tabsId = 'annotationReturnedDataTabs';
  const tabList = document.createElement('ul');
  tabList.className = 'nav nav-tabs mb-3';
  tabList.id = tabsId;
  tabList.role = 'tablist';
  const tabContent = document.createElement('div');
  tabContent.className = 'tab-content';
  chunks.forEach((chunk, chunkIndex) => {
    const pages = Array.isArray(chunk.pages) && chunk.pages.length
      ? `Pages ${chunk.pages[0] + 1}-${chunk.pages.at(-1) + 1}`
      : 'Page range not retained';
    const rangeId = String(chunk.range_id || `annotation-range-${chunkIndex}`)
      .replace(/[^a-zA-Z0-9_-]/g, '-');
    const tabId = `annotation-returned-tab-${rangeId}`;
    const paneId = `annotation-returned-pane-${rangeId}`;
    const tabItem = document.createElement('li');
    tabItem.className = 'nav-item';
    tabItem.role = 'presentation';
    const tab = document.createElement('button');
    tab.className = `nav-link${chunkIndex === 0 ? ' active' : ''}`;
    tab.type = 'button';
    tab.id = tabId;
    tab.dataset.bsToggle = 'tab';
    tab.dataset.bsTarget = `#${paneId}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', paneId);
    tab.setAttribute('aria-selected', String(chunkIndex === 0));
    tab.textContent = pages;
    tabItem.append(tab);
    tabList.append(tabItem);

    const pane = document.createElement('div');
    pane.className = `tab-pane fade${chunkIndex === 0 ? ' show active' : ''}`;
    pane.id = paneId;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', tabId);
    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-responsive border rounded-3 overflow-hidden';
    const table = document.createElement('table');
    table.className = 'table table-sm align-top mb-0';
    table.innerHTML = '<colgroup><col style="width: 58%"><col style="width: 22%"><col style="width: 20%"></colgroup><thead class="table-light"><tr><th scope="col" class="small fw-medium text-secondary">Semantic extraction</th><th scope="col" class="small fw-medium text-secondary">Item details</th><th scope="col" class="small fw-medium text-secondary">OCR source</th></tr></thead>';
    const tbody = document.createElement('tbody');
    const groups = Object.entries(chunk.annotation || {});
    if (!groups.length) groups.push(['No structured group returned', {}]);
    groups.forEach(([groupName, groupValue]) => {
      const groupRow = document.createElement('tr');
      groupRow.className = 'table-light';
      const groupCell = document.createElement('th');
      groupCell.colSpan = 3;
      groupCell.scope = 'colgroup';
      groupCell.className = 'p-0';
      const groupToggle = document.createElement('button');
      groupToggle.type = 'button';
      groupToggle.className = 'btn btn-sm w-100 d-flex align-items-center justify-content-between text-start px-3 py-2 rounded-0';
      groupToggle.setAttribute('aria-expanded', 'true');
      const groupLabel = document.createElement('span');
      groupLabel.className = 'small fw-semibold';
      groupLabel.textContent = `${groupName} · ${pages}`;
      const groupIcon = document.createElement('i');
      groupIcon.className = 'bi bi-chevron-down small text-secondary';
      groupIcon.setAttribute('aria-hidden', 'true');
      groupToggle.append(groupLabel, groupIcon);
      groupCell.append(groupToggle);
      groupRow.append(groupCell);
      tbody.append(groupRow);
      const groupRows = [];

      const fields = groupValue && typeof groupValue === 'object' && !Array.isArray(groupValue)
        ? Object.entries(groupValue)
        : [['value', groupValue]];
      fields.forEach(([fieldName, fieldValue]) => {
        const items = fieldName === 'prose_block_types' && fieldValue && typeof fieldValue === 'object'
          ? Object.entries(fieldValue).map(([blockKey, classification]) => ({ item: { classification }, fallback: blockKey }))
          : Array.isArray(fieldValue)
            ? fieldValue.map((item) => ({ item, fallback: '' }))
            : [{ item: fieldValue, fallback: '' }];
        if (!items.length) {
          items.push({ item: null, fallback: 'No items returned' });
        }
        items.forEach(({ item, fallback }) => {
          const row = document.createElement('tr');
          row.dataset.annotationReturnedRange = String(chunk.range_id || `annotation-range-${chunkIndex}`);
          row.dataset.annotationReturnedGroup = groupName;
          row.dataset.annotationReturnedField = fieldName;
          const value = document.createElement('td');
          value.className = 'p-3';
          const field = document.createElement('code');
          field.className = 'small text-secondary d-block mb-1';
          field.textContent = fieldName;
          const text = document.createElement('div');
          text.className = 'small text-body text-break';
          text.textContent = itemText(item, fallback);
          value.append(field, text);
          const details = document.createElement('td');
          details.className = 'p-3';
          const id = item && typeof item === 'object' && item.id ? String(item.id) : '';
          if (id) {
            const idLabel = document.createElement('code');
            idLabel.className = 'd-block small text-secondary text-break';
            idLabel.textContent = id;
            details.append(idLabel);
          }
          const classification = item && typeof item === 'object' ? item.classification : '';
          if (classification) {
            const badge = document.createElement('span');
            badge.className = 'badge text-bg-light border fw-normal';
            badge.textContent = classification;
            details.append(badge);
          }
          if (!id && !classification) {
            const range = document.createElement('code');
            range.className = 'small text-secondary text-break';
            range.textContent = String(chunk.range_id || `annotation-range-${chunkIndex}`);
            details.append(range);
          }
          const source = document.createElement('td');
          source.className = 'p-3';
          const location = sourceFor(item, fallback);
          if (location.page) {
            const page = document.createElement('div');
            page.className = 'small fw-semibold';
            page.textContent = `OCR page ${location.page}`;
            source.append(page);
          }
          if (location.blockId) {
            const block = document.createElement('code');
            block.className = 'd-block small text-secondary mt-1 text-break';
            block.textContent = location.blockId;
            source.append(block);
          }
          if (!location.page && !location.blockId) {
            const unavailable = document.createElement('span');
            unavailable.className = 'small text-secondary';
            unavailable.textContent = 'No OCR source returned';
            source.append(unavailable);
          }
          row.append(value, details, source);
          tbody.append(row);
          groupRows.push(row);
        });
      });
      groupToggle.addEventListener('click', () => {
        const expanded = groupToggle.getAttribute('aria-expanded') !== 'true';
        groupToggle.setAttribute('aria-expanded', String(expanded));
        groupIcon.className = `bi bi-chevron-${expanded ? 'down' : 'right'} small text-secondary`;
        groupRows.forEach((row) => { row.hidden = !expanded; });
      });
    });
    table.append(tbody);
    tableWrap.append(table);
    pane.append(tableWrap);
    tabContent.append(pane);
  });
  container.append(tabList, tabContent);
}
function renderReferenceInventoryDiagnostics() {
  const blocks = referenceBlocksFromRawPages(state.raw?.pages || []);
  const formatOverview = el('#referenceAnnotationFormatOverview');
  const formatCode = el('#referenceAnnotationFormatCode');
  const promptList = el('#referenceAnnotationPromptInstructions');
  const promptText = el('#referenceAnnotationPromptText');
  const metrics = el('#referenceInventoryMetrics');
  const status = el('#referenceInventoryStatus');
  const audit = el('#referenceInventoryAudit');
  formatOverview.replaceChildren();
  formatCode.textContent = '';
  promptList.replaceChildren();
  promptText.textContent = '';
  metrics.replaceChildren();
  status.replaceChildren();
  audit.replaceChildren();

  if (blocks.length) {
    const format = referenceAnnotationFormat(blocks);
    renderSchemaOverview({ container: formatOverview, format, idPrefix: 'referenceSchema' });
    formatCode.textContent = JSON.stringify(format, null, 2);
    promptText.textContent = referenceAnnotationPrompt(blocks);
  }
  referenceAnnotationPromptInstructions.forEach((instruction) => {
    const item = document.createElement('li');
    item.className = 'mb-2';
    item.textContent = instruction;
    promptList.append(item);
  });

  const inventory = state.referenceInventory || {};
  const references = inventory.references?.length
    ? inventory.references
    : (state.annotations.references?.references || []);
  const issues = Array.isArray(inventory.issues) ? inventory.issues : [];
  const coverage = inventory.coverage || null;
  [
    ['Bibliography OCR blocks', blocks.length],
    ['Individual references', references.length],
    ['Text coverage', coverage ? `${coverage.percent}%` : '—'],
    ['Contract issues', issues.length]
  ].forEach(([label, value]) => {
    const metric = document.createElement('div');
    metric.className = 'border rounded-3 bg-body px-3 py-2 text-end';
    const count = document.createElement('div');
    count.className = 'small fw-semibold';
    count.textContent = String(value);
    const caption = document.createElement('div');
    caption.className = 'small text-secondary';
    caption.textContent = label;
    metric.append(count, caption);
    metrics.append(metric);
  });

  const events = runtime.entries();
  const eventByKey = (key) => [...events].reverse().find((event) => event.key === key) || null;
  const rawOcrEvent = eventByKey('raw-ocr');
  const requestEvent = eventByKey('reference-inventory:start');
  const returnedEvent = eventByKey('reference-inventory:returned');
  const acceptedEvent = eventByKey('reference-inventory:accepted');
  const targetsEvent = eventByKey('reference-inventory:ready');
  const unavailableEvent = eventByKey('reference-inventory:unavailable');
  const completedState = inventory.status === 'ready' ? 'ready' : inventory.status === 'unavailable' ? 'unavailable' : inventory.status === 'pending' ? 'pending' : 'waiting';
  const flowStages = [
    { label: 'Raw OCR bibliography scope', icon: 'bi-file-earmark-text', event: rawOcrEvent, state: blocks.length ? 'ready' : completedState, detail: blocks.length ? `${blocks.length} OCR bibliography blocks selected from the raw OCR response.` : 'No bibliography OCR blocks were selected.' },
    { label: 'Focused annotation request', icon: 'bi-send', event: requestEvent, state: requestEvent ? (completedState === 'waiting' ? 'pending' : 'ready') : completedState, detail: requestEvent?.detail || 'No focused bibliography request was recorded.' },
    { label: 'Reference inventory returned', icon: 'bi-list-ol', event: returnedEvent || unavailableEvent, state: returnedEvent ? 'ready' : unavailableEvent ? 'unavailable' : completedState === 'pending' ? 'pending' : 'waiting', detail: returnedEvent?.detail || unavailableEvent?.detail || 'The annotation response has not been recorded yet.' },
    { label: 'Passive contract check', icon: 'bi-shield-check', event: acceptedEvent || unavailableEvent, state: acceptedEvent ? 'ready' : unavailableEvent ? 'unavailable' : completedState === 'pending' ? 'pending' : 'waiting', detail: acceptedEvent?.detail || unavailableEvent?.detail || 'Checks have not completed yet.' },
    { label: 'Individual HTML targets', icon: 'bi-link-45deg', event: targetsEvent || unavailableEvent, state: completedState, detail: targetsEvent?.detail || unavailableEvent?.detail || 'Stable HTML targets have not been created yet.' }
  ];
  const flowSection = document.createElement('section');
  flowSection.className = 'mb-3';
  flowSection.dataset.referenceInventoryFlow = '';
  const flowHeading = document.createElement('h3');
  flowHeading.className = 'h6 mb-1';
  flowHeading.textContent = 'Processing flow';
  const flowDescription = document.createElement('p');
  flowDescription.className = 'small text-secondary mb-2';
  flowDescription.textContent = 'Timestamps are measured from the start of this review. This view reports existing processing events only.';
  const flow = document.createElement('div');
  flow.className = 'runtime-dependency-flow d-grid gap-2 bg-light-subtle border rounded-3 p-3';
  flowStages.forEach((stage, index) => {
    const node = document.createElement('div');
    node.className = 'runtime-dependency-step position-relative border rounded-3 bg-body p-3';
    node.dataset.runtimeState = stage.state;
    const step = document.createElement('div');
    step.className = 'small text-secondary mb-2';
    step.textContent = `Step ${index + 1}`;
    const title = document.createElement('div');
    title.className = 'small fw-semibold mb-2';
    const icon = document.createElement('i');
    icon.className = `bi ${stage.icon} text-secondary me-2`;
    icon.setAttribute('aria-hidden', 'true');
    title.append(icon, stage.label);
    const statusNode = runtimeStatus(stage.state, stage.event?.elapsedMs ?? null, stage.detail);
    const detail = document.createElement('div');
    detail.className = 'small text-secondary mt-2';
    detail.textContent = stage.detail;
    node.append(step, title, statusNode, detail);
    flow.append(node);
  });
  flowSection.append(flowHeading, flowDescription, flow);
  status.append(flowSection);

  const explanation = document.createElement('div');
  explanation.className = 'alert alert-light border small mb-2';
  explanation.textContent = 'Mistral separates the bounded bibliography OCR input into complete individual references. DeskReview renders every returned reference as its own stable HTML target. The focused response does not assign references back to individual raw OCR blocks.';
  status.append(explanation);

  const alert = document.createElement('div');
  const tone = coverage && coverage.ratio < 0.9
    ? 'alert-warning'
    : inventory.status === 'ready'
    ? 'alert-success'
    : inventory.status === 'unavailable'
      ? 'alert-warning'
      : 'alert-light border';
  alert.className = `alert ${tone} small mb-0`;
  if (!blocks.length) {
    alert.textContent = 'Raw OCR did not return bibliography blocks for a focused inventory request.';
  } else if (coverage && coverage.ratio < 0.9) {
    alert.textContent = `The returned reference text covers only ${coverage.percent}% of the supplied OCR bibliography blocks. This inventory is incomplete.`;
  } else if (inventory.status === 'ready') {
    alert.textContent = `${references.length} individual references were returned and prepared as separate HTML targets.`;
  } else if (inventory.status === 'unavailable') {
    alert.textContent = inventory.error || 'The focused bibliography response was unavailable.';
  } else if (inventory.status === 'pending') {
    alert.textContent = 'The focused bibliography inventory is still being prepared.';
  } else {
    alert.textContent = 'No focused bibliography inventory result was recorded for this review.';
  }
  status.append(alert);

  const section = document.createElement('section');
  section.className = 'mb-3';
  section.dataset.referenceBlockAudit = '';
  const heading = document.createElement('div');
  heading.className = 'd-flex flex-wrap align-items-end justify-content-between gap-2 mb-2';
  const headingText = document.createElement('div');
  const title = document.createElement('h3');
  title.className = 'h6 mb-1';
  title.textContent = 'Individual references returned';
  const description = document.createElement('p');
  description.className = 'small text-secondary mb-0';
  description.textContent = 'The focused response is deliberately flat: each row is one model-returned reference and one HTML target.';
  headingText.append(title, description);
  const count = document.createElement('span');
  count.className = 'small text-secondary';
  count.textContent = `${references.length} references`;
  heading.append(headingText, count);
  section.append(heading);

  if (!references.length) {
    const empty = document.createElement('div');
    empty.className = 'alert alert-light border small mb-0';
    empty.textContent = inventory.status === 'pending' ? 'The individual reference list is still being prepared.' : 'No individual references were returned.';
    section.append(empty);
    audit.append(section);
    return;
  }

  const tableWrap = document.createElement('div');
  tableWrap.className = 'table-responsive border rounded-3 overflow-hidden';
  const table = document.createElement('table');
  table.className = 'table table-sm align-middle mb-0';
  table.innerHTML = '<thead class="table-light"><tr><th scope="col">#</th><th scope="col">Reference</th><th scope="col">HTML target</th></tr></thead>';
  const tableBody = document.createElement('tbody');
  references.forEach((reference, index) => {
    const row = document.createElement('tr');
    row.dataset.referenceAuditItem = String(index + 1);
    const number = document.createElement('th');
    number.scope = 'row';
    number.className = 'small fw-medium text-secondary text-nowrap';
    number.textContent = String(index + 1);
    const text = document.createElement('td');
    text.className = 'small text-break';
    text.textContent = reference.text || 'Reference text was not returned.';
    const target = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge fw-normal bg-success-subtle text-success-emphasis';
    badge.textContent = 'Ready';
    target.append(badge);
    row.append(number, text, target);
    tableBody.append(row);
  });
  table.append(tableBody);
  tableWrap.append(table);
  section.append(tableWrap);
  audit.append(section);
}
function renderCitationGroundingAudit() {
  const metrics = el('#citationGroundingAuditMetrics');
  const container = el('#citationGroundingAudit');
  metrics.replaceChildren();
  container.replaceChildren();
  const ranges = state.citationExtraction?.ranges || [];
  const totals = ranges.reduce((summary, range) => ({
    returned: summary.returned + range.returned,
    accepted: summary.accepted + range.accepted,
    rejected: summary.rejected + range.rejected
  }), { returned: 0, accepted: 0, rejected: 0 });
  [
    ['Citation mentions found', totals.returned],
    ['OCR source anchor verified', totals.accepted],
    ['Could not verify', totals.rejected]
  ].forEach(([label, value]) => {
    const metric = document.createElement('div');
    metric.className = 'border rounded-3 bg-body px-3 py-2 text-end';
    const count = document.createElement('div');
    count.className = 'small fw-semibold';
    count.textContent = String(value);
    const caption = document.createElement('div');
    caption.className = 'small text-secondary';
    caption.textContent = label;
    metric.append(count, caption);
    metrics.append(metric);
  });
  if (!ranges.length) {
    const empty = document.createElement('div');
    empty.className = 'alert alert-light border small mb-0';
    empty.textContent = 'No focused body-citation extraction ranges are available for this review.';
    container.append(empty);
    return;
  }
  const reasonLabels = {
    label_not_in_context: 'The returned citation passage does not contain the complete citation marker Mistral reported',
    context_not_unique_in_raw_ocr: 'The citation passage occurs in more than one OCR text block in this older stored review, so its source is ambiguous',
    context_not_in_declared_ocr_block: 'The exact citation marker was not found in the OCR text block Mistral identified as its source',
    citation_occurrence_exceeds_source: 'Mistral returned this citation marker more often than it occurs in the identified OCR text block',
    validation_failed: 'The citation response did not pass exact source verification',
    request_unavailable: 'Mistral did not return a usable response for this citation request'
  };
  const sourceLabel = (item) => {
    const pageMatch = /^ocr-page-(\d+)$/.exec(String(item.pageId || ''));
    const blockMatch = /^ocr-block-\d+-(\d+)$/.exec(String(item.blockId || ''));
    if (!pageMatch || !blockMatch) return 'Not returned';
    return `Page ${Number(pageMatch[1]) + 1} · block ${Number(blockMatch[1]) + 1}`;
  };
  const requestSection = document.createElement('section');
  requestSection.className = 'mb-4';
  const requestTitle = document.createElement('h4');
  requestTitle.className = 'h6 mb-1';
  requestTitle.textContent = 'Citation extraction requests';
  const requestDescription = document.createElement('p');
  requestDescription.className = 'small text-secondary mb-2';
  requestDescription.textContent = 'Each row is one bounded request. Article-text blocks is the number of OCR prose blocks checked in that request; Citation mentions is the number of individual in-text citations found inside them.';
  const requestTableWrap = document.createElement('div');
  requestTableWrap.className = 'table-responsive border rounded-3 overflow-hidden';
  const requestTable = document.createElement('table');
  requestTable.className = 'table table-sm align-middle mb-0';
  requestTable.innerHTML = '<thead class="table-light"><tr><th scope="col">Pages</th><th scope="col">Article-text blocks</th><th scope="col">Citation mentions</th><th scope="col">Result</th></tr></thead>';
  const requestBody = document.createElement('tbody');
  ranges.forEach((range, rangeIndex) => {
    const suppliedBlocks = Array.isArray(range.suppliedBlocks) ? range.suppliedBlocks : [];
    const blockResults = Array.isArray(range.blockResults) ? range.blockResults : null;
    const row = document.createElement('tr');
    row.dataset.citationAuditRange = range.id;
    const pages = document.createElement('th');
    pages.scope = 'row';
    pages.className = 'small fw-medium text-nowrap p-0';
    const collapseId = `citation-audit-details-${String(range.id || rangeIndex).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-link link-body-emphasis text-decoration-none text-start w-100 d-inline-flex align-items-center gap-2 px-2 py-2 small fw-medium';
    toggle.dataset.bsToggle = 'collapse';
    toggle.dataset.bsTarget = `#${collapseId}`;
    toggle.dataset.citationAuditToggle = range.id;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', collapseId);
    const icon = document.createElement('i');
    icon.className = 'bi bi-chevron-right small text-secondary';
    icon.setAttribute('aria-hidden', 'true');
    const pageText = document.createElement('span');
    pageText.textContent = range.pages.length ? `${range.pages[0] + 1}–${range.pages.at(-1) + 1}` : String(rangeIndex + 1);
    toggle.append(icon, pageText);
    pages.append(toggle);
    const blocks = document.createElement('td');
    blocks.className = 'small text-nowrap';
    blocks.textContent = blockResults
      ? blockResults.length === suppliedBlocks.length
        ? `${suppliedBlocks.length} checked`
        : `${blockResults.length} responses · ${suppliedBlocks.length} checked`
      : `${suppliedBlocks.length} selected · no response`;
    blocks.title = `${suppliedBlocks.length} article-text OCR blocks selected in Step 2; ${blockResults?.length || 0} block responses returned by Mistral.`;
    const citations = document.createElement('td');
    citations.className = 'small text-nowrap';
    citations.textContent = `${range.returned} found · ${range.accepted} source verified${range.rejected ? ` · ${range.rejected} could not verify` : ''}`;
    const result = document.createElement('td');
    result.className = 'small';
    const badge = document.createElement('span');
    const unavailable = Boolean(range.reasonCounts?.request_unavailable);
    const validationFailed = Boolean(range.reasonCounts?.validation_failed) || (!unavailable && range.rejected > 0);
    badge.className = `badge fw-normal ${unavailable || validationFailed ? 'bg-warning-subtle text-warning-emphasis' : 'bg-success-subtle text-success-emphasis'}`;
    badge.textContent = unavailable ? 'Unavailable' : validationFailed ? 'Source verification failed' : 'Ready';
    result.append(badge);
    const details = unavailable
      ? [range.failureMessage || reasonLabels.request_unavailable]
      : validationFailed
        ? [`${range.rejected} citation passage${range.rejected === 1 ? '' : 's'} could not be verified against the identified OCR source. Expand this row for block-level details.`]
        : [];
    if (details.length) {
      const detail = document.createElement('div');
      detail.className = 'text-secondary mt-1';
      detail.textContent = details.join(' · ');
      result.append(detail);
    }
    row.append(pages, blocks, citations, result);
    requestBody.append(row);
    const detailRow = document.createElement('tr');
    const detailCell = document.createElement('td');
    detailCell.colSpan = 4;
    detailCell.className = 'p-0 border-0';
    const detailCollapse = document.createElement('div');
    detailCollapse.id = collapseId;
    detailCollapse.className = 'collapse bg-light-subtle border-top';
    const detailBody = document.createElement('div');
    detailBody.className = 'p-3 vstack gap-2';
    detailCollapse.addEventListener('show.bs.collapse', () => icon.classList.replace('bi-chevron-right', 'bi-chevron-down'));
    detailCollapse.addEventListener('hide.bs.collapse', () => icon.classList.replace('bi-chevron-down', 'bi-chevron-right'));
    const returnedBlockIds = new Set((blockResults || []).map((block) => block?.ocr_block_id).filter(Boolean));
    suppliedBlocks.forEach((block) => {
      const blockItems = (range.items || []).filter((item) => item.blockId === block.blockId);
      const blockCard = document.createElement('section');
      blockCard.className = 'border rounded-2 bg-body p-3';
      blockCard.dataset.citationAuditBlock = block.blockId;
      const blockHeader = document.createElement('div');
      blockHeader.className = 'd-flex flex-wrap align-items-center justify-content-between gap-2';
      const blockTitle = document.createElement('div');
      blockTitle.className = 'small fw-semibold';
      blockTitle.textContent = sourceLabel({ pageId: block.pageId, blockId: block.blockId });
      const blockBadge = document.createElement('span');
      blockBadge.className = `badge fw-normal ${returnedBlockIds.has(block.blockId) ? 'text-bg-light border' : 'bg-warning-subtle text-warning-emphasis'}`;
      blockBadge.textContent = returnedBlockIds.has(block.blockId)
        ? `${blockItems.length} citation mention${blockItems.length === 1 ? '' : 's'} found`
        : 'Block result missing';
      blockHeader.append(blockTitle, blockBadge);
      blockCard.append(blockHeader);
      if (blockItems.length) {
        const occurrenceList = document.createElement('div');
        occurrenceList.className = 'list-group list-group-flush mt-2';
        blockItems.forEach((item) => {
          const occurrence = document.createElement('div');
          occurrence.className = 'list-group-item px-0 py-2 bg-transparent d-flex align-items-start justify-content-between gap-3';
          const occurrenceText = document.createElement('div');
          occurrenceText.className = 'small text-break';
          occurrenceText.textContent = item.anchorText || 'Not returned';
          const occurrenceStatus = document.createElement('div');
          occurrenceStatus.className = 'small text-end flex-shrink-0';
          const occurrenceBadge = document.createElement('span');
          occurrenceBadge.className = `badge fw-normal ${item.accepted ? 'bg-success-subtle text-success-emphasis' : 'bg-warning-subtle text-warning-emphasis'}`;
          occurrenceBadge.textContent = item.accepted ? 'Source verified' : 'Could not verify';
          occurrenceStatus.append(occurrenceBadge);
          if (item.reasons.length) {
            const reason = document.createElement('div');
            reason.className = 'text-warning-emphasis mt-1';
            reason.textContent = item.reasons.map((value) => reasonLabels[value] || value).join(' · ');
            occurrenceStatus.append(reason);
          }
          occurrence.append(occurrenceText, occurrenceStatus);
          occurrenceList.append(occurrence);
        });
        blockCard.append(occurrenceList);
      } else {
        const empty = document.createElement('div');
        empty.className = 'small text-secondary mt-2';
        empty.textContent = returnedBlockIds.has(block.blockId) ? 'No citation mentions were found in this block.' : 'Mistral did not return a result for this selected block.';
        blockCard.append(empty);
      }
      const sourceDetails = document.createElement('details');
      sourceDetails.className = 'mt-2';
      const sourceSummary = document.createElement('summary');
      sourceSummary.className = 'small link-secondary';
      sourceSummary.textContent = 'View supplied OCR block text';
      const sourceText = document.createElement('pre');
      sourceText.className = 'developer-contract-code border rounded-2 mt-2 mb-0';
      sourceText.textContent = block.text || '';
      sourceDetails.append(sourceSummary, sourceText);
      blockCard.append(sourceDetails);
      detailBody.append(blockCard);
    });
    detailCollapse.append(detailBody);
    detailCell.append(detailCollapse);
    detailRow.append(detailCell);
    requestBody.append(detailRow);
  });
  requestTable.append(requestBody);
  requestTableWrap.append(requestTable);
  requestSection.append(requestTitle, requestDescription, requestTableWrap);
  container.append(requestSection);
}
function renderFocusedCitationContract() {
  const container = el('#citationAnnotationFormatOverview');
  const code = el('#citationAnnotationFormatCode');
  const promptCode = el('#citationAnnotationPromptText');
  container.replaceChildren();
  code.textContent = '';
  promptCode.textContent = '';
  const firstRange = bodyCitationBlockRanges(state.annotationChunks, state.raw?.pages || [])[0];
  if (firstRange?.blocks.length) {
    const format = citationAnnotationFormat(firstRange.blocks);
    renderSchemaOverview({ container, format, idPrefix: 'citationSchema' });
    code.textContent = JSON.stringify(format, null, 2);
    promptCode.textContent = citationAnnotationPrompt(firstRange.blocks);
  } else {
    const unavailable = document.createElement('div');
    unavailable.className = 'alert alert-light border small mb-0';
    unavailable.textContent = 'The exact body-citation schema is generated from the live OCR article-block packet. This stored review did not retain that packet.';
    container.append(unavailable);
    promptCode.textContent = 'The exact prompt and OCR block packet were not retained for this stored review.';
  }
  const list = el('#citationAnnotationPromptInstructions');
  list.replaceChildren();
  citationAnnotationPromptInstructions.forEach((instruction) => {
    const item = document.createElement('li');
    item.className = 'mb-2';
    item.textContent = instruction;
    list.append(item);
  });
}
function renderDeveloperDiagnosticsContext() {
  el('#developerDiagnosticsOrigin').textContent = window.location.origin;
  el('#developerDiagnosticsTime').textContent = `Opened ${new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(new Date())}`;
}
function renderDocumentQnaDiagnostics() {
  const container = el('#documentQnaOverview');
  container.replaceChildren();
  const sections = [
    { label: 'Reference relations', value: state.documentQna?.references },
    { label: 'Table and figure relations', value: state.documentQna?.displays }
  ];
  sections.forEach(({ label, value }) => {
    const card = document.createElement('section');
    card.className = 'border rounded-3 bg-body p-3';
    const heading = document.createElement('div');
    heading.className = 'd-flex align-items-center justify-content-between gap-3 mb-2';
    const title = document.createElement('h4');
    title.className = 'h6 mb-0';
    title.textContent = label;
    const status = document.createElement('span');
    status.className = `badge fw-normal ${value?.status === 'ready' ? 'bg-success-subtle text-success-emphasis' : value?.status === 'unavailable' ? 'bg-warning-subtle text-warning-emphasis' : 'text-bg-light border'}`;
    status.textContent = value?.status === 'ready' ? 'Ready' : value?.status === 'unavailable' ? 'Unavailable' : 'Not recorded';
    heading.append(title, status);
    card.append(heading);
    if (value?.inputs) {
      const inputs = document.createElement('div');
      inputs.className = 'small text-secondary mb-2';
      inputs.textContent = Object.entries(value.inputs).map(([key, count]) => `${key}: ${count}`).join(' · ');
      card.append(inputs);
    }
    if (value?.links) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.className = 'small fw-semibold';
      summary.textContent = 'View returned mappings';
      const raw = document.createElement('pre');
      raw.className = 'developer-contract-code border rounded-2 mt-2 mb-0';
      raw.textContent = JSON.stringify(value.links, null, 2);
      details.append(summary, raw);
      card.append(details);
    } else {
      const empty = document.createElement('div');
      empty.className = 'small text-secondary';
      empty.textContent = value?.message || 'No Document QnA response was recorded for this review.';
      card.append(empty);
    }
    container.append(card);
  });
}
function setMode(mode) { const pdf = mode === 'pdf'; pdfPane.classList.toggle('d-none', !pdf); htmlPane.classList.toggle('d-none', pdf); pdfMode.classList.toggle('active', pdf); htmlMode.classList.toggle('active', !pdf); if (state.search.matches.length) requestAnimationFrame(() => showSearchMatch()); }
function setCount(kind, value = '—', loading = false) {
  const tile = el(`[data-count="${kind}"]`);
  if (!tile) return;
  const valueNode = tile.querySelector('strong');
  const previous = valueNode?.textContent || '';
  tile.classList.toggle('is-loading', loading);
  if (valueNode) valueNode.textContent = value;
  const readyValue = !loading && value !== 'Counting' && value !== '—' && value !== '-';
  if (readyValue && previous !== value) {
    tile.classList.remove('count-value-revealed');
    void tile.offsetWidth;
    tile.classList.add('count-value-revealed');
    window.setTimeout(() => tile.classList.remove('count-value-revealed'), 900);
  }
}
function setTileProgress(kind, value = 0, label = '') { const tile = el(`[data-count="${kind}"]`); if (!tile) return; const progress = Math.max(0, Math.min(100, Number(value) || 0)); tile.style.setProperty('--tile-progress', `${progress}%`); tile.classList.toggle('is-enriching', progress > 0 && progress < 100); tile.dataset.progressLabel = label; }
function setTocPending(message = 'Preparing the table of contents...') {
  const pending = document.createElement('div');
  pending.className = 'toc-pending d-flex align-items-center gap-2 px-2 py-2 small text-secondary';
  pending.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>';
  const label = document.createElement('span');
  label.textContent = message;
  pending.append(label);
  toc.replaceChildren(pending);
}
function showProgress() { document.querySelectorAll('[data-count]').forEach((tile) => { setCategoryState(tile.dataset.count, 'extracting'); setCount(tile.dataset.count, 'Counting', true); setTileProgress(tile.dataset.count, 0, 'Counting'); }); setTocPending(); note.textContent = 'Preparing the manuscript reader.'; }
function settlePendingCounts() {
  document.querySelectorAll('[data-count].is-loading').forEach((tile) => {
    const kind = tile.dataset.count;
    const pass = detailPass(kind);
    if (pass && state.annotationStatus[pass] === 'pending') return;
    if (pass && state.annotationStatus[pass] === 'unavailable') {
      setCategoryState(kind, 'unavailable');
      setCount(kind, '—', false);
      setTileProgress(kind, 0, 'Unavailable');
      return;
    }
    const items = sourceItems(kind);
    const value = items.length ? String(items.length) : '—';
    setCategoryState(kind, items.length ? 'counted' : 'unavailable');
    setCount(kind, value, false);
    setTileProgress(kind, items.length ? 72 : 0, items.length ? 'Partially ready' : 'Unavailable');
  });
  refreshOpenDetails(['authors', 'affiliations', 'abstract', 'article', 'keywords', 'references', 'tables', 'figures']);
}
function sourcePage(item = {}) { return Number(item?.source?.page_number || 0); }
function resolveSource(item = {}) {
  const declared = validateDeclaredSource(state.raw?.pages || [], item);
  if (!declared) return null;
  const page = state.raw.pages[declared.pageNumber - 1];
  const rendered = renderMarkdown(page.markdown || page.content || '');
  const sourceBlock = Number.isInteger(declared.blockIndex) ? page.blocks?.[declared.blockIndex] : null;
  const anchorQuote = markdownLabel(sourceBlock?.content || declared.quote);
  const itemQuote = markdownLabel(item?.item_exact_quote || item?.source?.item_exact_quote || item?.text || item?.label || declared.quote);
  const renderedText = plain(rendered);
  return {
    ...declared,
    anchorQuote,
    itemQuote,
    canHighlight: Boolean(itemQuote) && renderedText.includes(itemQuote)
  };
}
function sourceIsUsable(item = {}) { return Boolean(resolveSource(item)); }
function labelFor(kind) { return categoryLabels[kind] || kind; }
function countUnit(kind, value) { const forms = { authors: ['author', 'authors'], affiliations: ['affiliation', 'affiliations'], abstract: ['word', 'words'], article: ['word', 'words'], keywords: ['keyword', 'keywords'], references: ['reference', 'references'], tables: ['table', 'tables'], figures: ['figure', 'figures'] }; const [singular, plural] = forms[kind] || ['item', 'items']; return Number(value) === 1 ? singular : plural; }
function recordCountReady(kind, value) { recordRuntime(`${labelFor(kind)} count ready`, `${value} ${countUnit(kind, value)} returned.`, `count:${kind}`); }
function recordSourceLinksReady(kind) { const items = sourceItems(kind); const confirmed = kind === 'references' ? items.filter((item) => item.link_handle).length : items.filter(sourceIsUsable).length; const detail = items.length ? kind === 'references' ? `${confirmed}/${items.length} stable HTML reference targets ready.` : `${confirmed}/${items.length} exact HTML source links confirmed.` : 'No source-linked items were returned.'; recordRuntime(`${labelFor(kind)} source links ready`, detail, `links:${kind}`); }
function categoryState(kind) { return state.categoryStates?.[kind] || 'waiting'; }
function categoryStateLabel(value) { return ({ waiting: 'waiting', extracting: 'extracting', counted: 'counted', linking: 'preparing source links', ready: 'ready', unavailable: 'unavailable' })[value] || value; }
function applyCategoryTileState(kind) {
  const tile = el(`[data-count="${kind}"]`);
  if (!tile) return;
  tile.dataset.categoryState = categoryState(kind);
  if (['tables', 'figures', 'references'].includes(kind)) tile.dataset.linkState = sourceLinkStatus(kind);
}
function setCategoryState(kind, next, detail = '') {
  if (!categoryKinds.includes(kind)) return;
  if (!state.categoryStates) state.categoryStates = initialCategoryStates();
  const previous = state.categoryStates[kind] || 'waiting';
  state.categoryStates[kind] = next;
  applyCategoryTileState(kind);
  if (previous !== next && !state.preservingRuntimeSnapshot) {
    recordRuntime(`${labelFor(kind)} ${categoryStateLabel(next)}`, detail, `state:${kind}:${next}`);
  }
}
function sourceLinkStatus(kind) { return kind === 'references' ? state.referenceLinksStatus : (state.sourceLinksByKind?.[kind] || state.sourceLinksStatus || 'idle'); }
function setSourceLinkStatus(kinds, status) {
  kinds.forEach((kind) => { state.sourceLinksByKind[kind] = status; applyCategoryTileState(kind); });
  const statuses = Object.values(state.sourceLinksByKind);
  state.sourceLinksStatus = statuses.every((value) => value === 'ready') ? 'ready'
    : statuses.some((value) => value === 'pending') ? 'pending'
      : statuses.every((value) => value === 'idle') ? 'idle'
        : 'unavailable';
}
function announceHtmlReady() { htmlMode.classList.remove('is-html-ready'); void htmlMode.offsetWidth; htmlMode.classList.add('is-html-ready'); }
function renderOcrMath(root = htmlDocument) {
  if (!root) return;
  renderMathInElement(root, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false }
    ],
    throwOnError: false,
    strict: 'ignore',
    errorCallback: () => {}
  });
}
function appendMarkdown(content, value = '') { renderMarkdown(value).split(/\n{2,}/).filter(Boolean).forEach((block) => { const heading = /^(#{1,6})\s+([\s\S]+)$/.exec(block.trim()); const node = document.createElement(heading ? `h${Math.min(6, heading[1].length + 1)}` : 'p'); node.className = heading ? 'ocr-markdown-heading' : 'ocr-markdown-paragraph'; node.innerHTML = inlineMarkdown(heading ? heading[2] : block); content.append(node); }); }
function safeTable(tableHtml = '') { const allowed = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'B', 'STRONG', 'I', 'EM', 'SUB', 'SUP', 'BR']); const source = new DOMParser().parseFromString(tableHtml, 'text/html').querySelector('table'); if (!source) return null; const copy = (node) => { if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue); if (!allowed.has(node.nodeName)) return document.createDocumentFragment(); const clone = document.createElement(node.nodeName.toLowerCase()); if (['TD', 'TH'].includes(node.nodeName)) ['colspan', 'rowspan'].forEach((name) => { const value = Number(node.getAttribute(name)); if (Number.isInteger(value) && value > 0) clone.setAttribute(name, String(value)); }); node.childNodes.forEach((child) => clone.append(copy(child))); return clone; }; return copy(source); }
function appendTableObject(content, table) {
  const rendered = safeTable(table?.content || '');
  if (!rendered) return false;
  const wrapper = document.createElement('div');
  wrapper.className = 'ocr-table-wrap';
  const responsive = document.createElement('div');
  responsive.className = 'table-responsive';
  rendered.classList.add('table', 'table-sm', 'align-middle', 'mb-0');
  responsive.append(rendered);
  wrapper.append(responsive);
  content.append(wrapper);
  return true;
}
function appendTables(content, tables = []) { tables.forEach((table) => appendTableObject(content, table)); }
async function renderFigureCrop(canvas, image, pageIndex, dimensions) { if (!state.pdf || !dimensions?.width || !dimensions?.height) return; const page = await state.pdf.getPage(pageIndex + 1); const viewport = page.getViewport({ scale: 1.3 }); const source = document.createElement('canvas'); source.width = Math.ceil(viewport.width); source.height = Math.ceil(viewport.height); await page.render({ canvasContext: source.getContext('2d', { alpha: false }), viewport }).promise; const scaleX = viewport.width / dimensions.width; const scaleY = viewport.height / dimensions.height; const x = Math.max(0, Math.floor(image.top_left_x * scaleX)); const y = Math.max(0, Math.floor(image.top_left_y * scaleY)); const width = Math.min(source.width - x, Math.ceil((image.bottom_right_x - image.top_left_x) * scaleX)); const height = Math.min(source.height - y, Math.ceil((image.bottom_right_y - image.top_left_y) * scaleY)); canvas.width = width; canvas.height = height; canvas.getContext('2d', { alpha: false }).drawImage(source, x, y, width, height, 0, 0, width, height); }
function imageDataUrl(value = '') { const source = String(value).trim(); return source.startsWith('data:image/') ? source : `data:image/jpeg;base64,${source}`; }
function appendFigureObject(content, image, pageIndex = 0, dimensions = null) {
  const figure = document.createElement('figure');
  figure.className = 'ocr-figure';
  if (image?.image_base64) {
    const img = document.createElement('img');
    img.className = 'img-fluid';
    img.src = imageDataUrl(image.image_base64);
    img.alt = `Figure from source page ${pageIndex + 1}`;
    figure.append(img);
  } else {
    const canvas = document.createElement('canvas');
    canvas.className = 'ocr-figure-canvas';
    canvas.setAttribute('aria-label', `Figure from source page ${pageIndex + 1}`);
    figure.append(canvas);
    renderFigureCrop(canvas, image, pageIndex, dimensions).catch(() => { canvas.replaceWith(document.createTextNode('Figure preview unavailable.')); });
  }
  content.append(figure);
  return true;
}
function appendFigures(content, images = [], pageIndex = 0, dimensions = null) { images.forEach((image) => appendFigureObject(content, image, pageIndex, dimensions)); }
function appendMarkdownWithAssets(content, markdown = '', page = {}, pageIndex = 0) {
  const tableById = new Map((page.tables || []).map((table) => [table.id || table.table_id, table]).filter(([id]) => id));
  const imageById = new Map((page.images || []).map((image) => [image.id || image.image_id, image]).filter(([id]) => id));
  const usedTables = new Set();
  const usedImages = new Set();
  const pattern = /!?\[[^\]]*\]\(((?:tbl|img)-\d+\.[^)]+)\)/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(markdown))) {
    appendMarkdown(content, markdown.slice(cursor, match.index));
    const id = match[1];
    if (tableById.has(id)) {
      if (appendTableObject(content, tableById.get(id))) usedTables.add(id);
    } else if (imageById.has(id)) {
      if (appendFigureObject(content, imageById.get(id), pageIndex, page.dimensions)) usedImages.add(id);
    }
    cursor = pattern.lastIndex;
  }
  appendMarkdown(content, markdown.slice(cursor));
  (page.tables || []).forEach((table) => { const id = table.id || table.table_id; if (!id || !usedTables.has(id)) appendTableObject(content, table); });
  (page.images || []).forEach((image) => { const id = image.id || image.image_id; if (!id || !usedImages.has(id)) appendFigureObject(content, image, pageIndex, page.dimensions); });
}
function referenceHtmlProjection(pages = []) {
  const references = state.annotations.references?.references || [];
  const blocks = referenceBlocksFromRawPages(pages);
  if (!references.length || !blocks.length) return { pageNumbers: new Set(), targetPageNumber: 0, references: [] };
  const pageNumbers = new Set(blocks.map((block) => block.pageIndex + 1));
  return { pageNumbers, targetPageNumber: Math.min(...pageNumbers), references };
}
function appendAnnotatedReferences(content, references = [], pageHasReferenceHeading = false) {
  if (!references.length) return;
  const list = document.createElement('ol'); list.className = 'ocr-reference-list'; list.start = Number(references[0].number || 1);
  if (!pageHasReferenceHeading) list.setAttribute('aria-label', 'References');
  references.forEach((reference, index) => {
    const item = document.createElement('li');
    item.id = `reference-target-${index + 1}`;
    const printedNumber = Number(reference.number || 0);
    if (printedNumber) item.value = printedNumber;
    item.dataset.referenceNumber = String(reference.number || '');
    item.dataset.referenceHandle = String(reference.link_handle || '');
    item.dataset.referenceText = plain(reference.text).replace(/\s+/g, ' ').trim();
    item.textContent = reference.text;
    list.append(item);
  });
  content.append(list);
}
function showHtml(pages = []) {
  const scroll = el('.html-scroll')?.scrollTop || 0;
  const referenceProjection = referenceHtmlProjection(pages);
  htmlDocument.replaceChildren();
  pages.forEach((page, index) => {
    const section = document.createElement('section');
    section.className = 'ocr-page';
    section.dataset.page = String(index + 1);
    const label = document.createElement('span');
    label.className = 'ocr-page-label';
    label.textContent = `Page ${index + 1}`;
    const content = document.createElement('div');
    const pageNumber = index + 1;
    const isBibliographyPage = referenceProjection.pageNumbers.has(pageNumber);
    const markdown = isBibliographyPage && Array.isArray(page.blocks)
      ? page.blocks.filter((block) => String(block?.type || '').toLowerCase() !== 'references').map((block) => block.content || '').join('\n\n')
      : ocrMarkdownForPresentation(page);
    appendMarkdownWithAssets(content, markdown, page, index);
    if (pageNumber === referenceProjection.targetPageNumber) {
      const hasReferenceHeading = /(^|\n)#{1,6}\s+References\s*($|\n)/i.test(markdown);
      appendAnnotatedReferences(content, referenceProjection.references, hasReferenceHeading);
    }
    section.append(label, content);
    htmlDocument.append(section);
  });
  if (pages.length) {
    renderOcrMath();
    announceHtmlReady();
    requestAnimationFrame(() => {
      const host = el('.html-scroll');
      if (host) host.scrollTop = scroll;
      if (state.search.matches.length && !htmlPane.classList.contains('d-none')) showSearchMatch();
    });
  }
}
function scrollPdfToPage(pageNumber, attempts = 0) { const target = el(`.pdf-page[data-page="${pageNumber}"]`); if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('pdf-page-target'); window.setTimeout(() => target?.classList.remove('pdf-page-target'), 1400); return; } if (state.pdf && attempts < 20) { window.setTimeout(() => scrollPdfToPage(pageNumber, attempts + 1), 100); return; } setMode('html'); el(`.ocr-page[data-page="${pageNumber}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function scrollHighlightedMark(mark) { mark?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); }
function jumpToTocEntry(entry) { const pageNumber = sourcePage(entry); if (!pageNumber) return; if (!pdfPane.classList.contains('d-none')) { scrollPdfToPage(pageNumber); return; } const target = el(`.ocr-page[data-page="${pageNumber}"]`); clearSourceHighlight(); const mark = highlightExactQuote(target, entry.heading); if (mark) scrollHighlightedMark(mark); else target?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function showToc(entries = []) { toc.replaceChildren(); if (!entries.length) { const empty = document.createElement('div'); empty.className = 'empty-note px-2 py-3 small text-secondary'; empty.textContent = 'No section headings were returned for this manuscript.'; toc.append(empty); return; } entries.forEach((entry) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'toc-button'; button.style.paddingLeft = `${.45 + Math.max(0, Number(entry.level || 1) - 1) * .7}rem`; button.textContent = entry.tocLabel || entry.heading; button.addEventListener('click', () => jumpToTocEntry(entry)); toc.append(button); }); }
function labelFirstTitle(entries = []) { let labelled = false; return entries.map((entry) => { if (!entry.isTitle || labelled) return entry; labelled = true; return { ...entry, tocLabel: 'Title' }; }); }
function rawBlockEntries(pages = [], types = []) { const entries = []; pages.forEach((page, pageIndex) => (page.blocks || []).forEach((block) => { const type = String(block.type || '').toLowerCase(); if (types.includes(type)) entries.push({ heading: headingLabel(block.content), isTitle: type === 'title', level: 1, source: { page_number: pageIndex + 1 } }); })); return labelFirstTitle(entries.filter((entry) => entry.heading)); }
function rawMarkdownHeadingEntries(pages = []) { return labelFirstTitle(pages.flatMap((page, pageIndex) => String(page.markdown || '').split(/\r?\n/).flatMap((line) => { const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line); if (!match) return []; return [{ heading: match[2], isTitle: match[1].length === 1, level: match[1].length, source: { page_number: pageIndex + 1 } }]; }))); }
function showRawOcr(raw = {}) { state.raw = raw; resetManuscriptSearch(); const pages = raw.pages || []; const typedEntries = rawBlockEntries(pages, ['title', 'heading']); const tocEntries = typedEntries.length ? typedEntries : rawMarkdownHeadingEntries(pages); const tableCount = pages.reduce((sum, page) => sum + (page.tables || []).length, 0); const figureCount = rawBlockEntries(pages, ['figure', 'image']).length; showHtml(pages); showToc(tocEntries); setCategoryState('tables', 'counted', 'Raw OCR table count is visible while source links are prepared.'); setCategoryState('figures', 'counted', 'Raw OCR figure count is visible while source links are prepared.'); setCount('tables', String(tableCount)); setCount('figures', String(figureCount)); setTileProgress('tables', 24, 'Preparing source links'); setTileProgress('figures', 24, 'Preparing source links'); recordRuntime('Table of contents ready', `${tocEntries.length} OCR headings returned.`, 'toc'); recordCountReady('tables', tableCount); recordCountReady('figures', figureCount); note.textContent = 'Reader ready. Additional counts and source links are being prepared.'; fileName.textContent = `${raw.fileName} · OCR source ready`; }
function applyAnnotationOcrPages(pageIndexes = [], ocrPages = []) {
  if (!state.raw?.pages?.length || !Array.isArray(pageIndexes) || !Array.isArray(ocrPages) || !ocrPages.length) return;
  const replacements = ocrPages.length === state.raw.pages.length
    ? pageIndexes.map((pageIndex) => ocrPages[pageIndex])
    : pageIndexes.map((_pageIndex, offset) => ocrPages[offset]);
  if (replacements.length !== pageIndexes.length || replacements.some((page) => !Array.isArray(page?.blocks))) return;
  pageIndexes.forEach((pageIndex, offset) => { state.raw.pages[pageIndex] = replacements[offset]; });
  showHtml(state.raw.pages);
  recordRuntime('Annotation OCR source ready', `${pageIndexes.length} source-grounded OCR page${pageIndexes.length === 1 ? '' : 's'} refreshed.`, `annotation-ocr:${pageIndexes[0]}`);
}
function refreshOpenDetails(kinds = []) { if (kinds.includes(state.openDetailKind)) openDetails(state.openDetailKind); }
function showFrontMatterCounts(annotation = {}, storedAuthorProfiles = null) {
  state.annotations['front-matter'] = annotation;
  state.annotationStatus['front-matter'] = 'ready';
  const exactAbstract = wordCountProvenanceFromBlocks(state.raw?.pages || [], annotation.abstract?.prose_blocks || []);
  if (exactAbstract.valid && annotation.abstract) {
    annotation.abstract.word_count = exactAbstract.count;
    annotation.abstract.word_count_provenance = exactAbstract;
  }
  const values = [['authors', annotation.authors?.length || 0], ['affiliations', annotation.affiliations?.length || 0], ['abstract', exactAbstract.valid ? exactAbstract.count : '—'], ['keywords', annotation.keywords?.length || 0]];
  values.forEach(([kind, value]) => {
    setCategoryState(kind, value === '—' ? 'unavailable' : 'counted');
    setCount(kind, String(value));
    setTileProgress(kind, kind === 'authors' ? 62 : 72, kind === 'authors' ? 'Preparing profiles' : 'Verifying source links');
    if (Number.isInteger(value)) recordCountReady(kind, value);
  });
  refreshOpenDetails(values.map(([kind]) => kind));
  if (Array.isArray(storedAuthorProfiles)) { state.authorProfiles = { status: 'ready', authors: storedAuthorProfiles }; setTileProgress('authors', 100, 'Ready'); if (!state.preservingRuntimeSnapshot) recordRuntime('Stored author profiles ready', `${storedAuthorProfiles.filter((profile) => profile?.status === 'found').length}/${annotation.authors?.length || 0} verified profiles loaded locally.`, 'author-profiles'); } else if (state.authorProfiles.status === 'idle') startAuthorProfileLookup(annotation.authors || []);
}
function showBodyCounts(annotation = {}) {
  state.annotations.body = annotation;
  const wordCount = wordCountProvenanceFromBlocks(state.raw?.pages || [], annotation.prose_blocks || []);
  const articleWords = wordCount.valid ? wordCount.count : null;
  if (wordCount.valid) annotation.word_count_provenance = wordCount;
  if (state.annotationStatus.body !== 'ready') {
    if (state.annotationStatus.body === 'unavailable') {
      setCategoryState('article', 'unavailable');
      setCount('article', '—', false);
      setTileProgress('article', 0, 'Unavailable');
      refreshOpenDetails(['article', 'tables', 'figures']);
      return;
    }
    setCategoryState('article', 'extracting');
    setCount('article', 'Counting', true);
    setTileProgress('article', 48, 'Selecting article text');
    refreshOpenDetails(['article', 'tables', 'figures']);
    return;
  }
  setCategoryState('article', articleWords === null ? 'unavailable' : 'counted');
  setCount('article', articleWords === null ? '—' : String(articleWords));
  setTileProgress('article', articleWords === null ? 72 : 76, articleWords === null ? 'Article text unavailable' : 'Verifying source links');
  if (articleWords !== null) recordCountReady('article', articleWords);
  refreshOpenDetails(['article', 'tables', 'figures']);
}
function showReferenceCounts(annotation = {}) {
  // A presentation handle targets the independently rendered HTML item. It is
  // semantics-free and also hydrates stored reviews created before v5.
  annotation = {
    ...annotation,
    references: (annotation.references || []).map((item, index) => ({
      ...item,
      link_handle: item.link_handle || item.id || `reference:${index + 1}`
    }))
  };
  state.annotations.references = annotation;
  const count = annotation.references?.length || 0;
  const complete = state.annotationStatus.references === 'ready';
  const inventoryCoverage = state.referenceInventory?.coverage || null;
  if (inventoryCoverage?.sourceCharacters && inventoryCoverage.ratio < MIN_REFERENCE_TEXT_COVERAGE) {
    setCategoryState('references', 'unavailable', `Only ${inventoryCoverage.percent}% of the OCR bibliography text was returned.`);
    setCount('references', '—', false);
    setTileProgress('references', 0, 'Incomplete bibliography');
    refreshOpenDetails(['references']);
    return;
  }
  if (state.annotationStatus.references === 'unavailable') {
    setCategoryState('references', 'unavailable');
    setCount('references', '—', false);
    setTileProgress('references', 0, 'Unavailable');
    refreshOpenDetails(['references']);
    return;
  }
  if (!complete) {
    setCategoryState('references', 'extracting', count ? `${count} references returned so far; final coverage is still pending.` : 'Reading bibliography ranges.');
    setCount('references', 'Counting', true);
    setTileProgress('references', count ? 62 : 36, count ? 'Still counting' : 'Reading bibliography');
    refreshOpenDetails(['references']);
    return;
  }
  setCategoryState('references', 'counted', 'All annotation ranges completed before publishing the reference count.');
  setCount('references', String(count));
  setTileProgress('references', complete ? 76 : 62, 'Preparing source links');
  recordCountReady('references', count);
  showHtml(state.raw?.pages || []);
  refreshOpenDetails(['references']);
}
async function runReferenceAnnotationStage(base64) {
  const referenceBlocks = referenceBlocksFromRawPages(state.raw?.pages || []);
  const pages = referenceBlocks.length ? referenceAnnotationPages(referenceBlocks) : [];
  state.referenceInventory = { status: 'pending', pages, blockCount: referenceBlocks.length, references: [], coverage: null, issues: [], error: '' };
  state.annotationStatus.references = 'pending';
  setCategoryState('references', 'extracting', 'Separating the bibliography into individual references.');
  setCount('references', 'Counting', true);
  setTileProgress('references', 34, 'Reading bibliography');
  refreshOpenDetails(['references']);
  if (!referenceBlocks.length) throw new Error('Raw OCR did not return reference-list blocks.');
  recordRuntime('Reference inventory started', `${referenceBlocks.length} OCR reference blocks sent in one bounded annotation request.`, 'reference-inventory:start');
  const response = await request('/api/ocr/references', JSON.stringify({ base64, referenceBlocks }));
  if (!response.response.ok) {
    state.referenceInventory = {
      status: 'unavailable',
      pages: response.result?.diagnostics?.pages || pages,
      blockCount: referenceBlocks.length,
      references: response.result?.diagnostics?.references || [],
      coverage: response.result?.diagnostics?.coverage || null,
      issues: response.result?.issues || [],
      error: response.result?.error || 'Reference inventory was unavailable.'
    };
    throw new Error(state.referenceInventory.error);
  }
  recordRuntime('Reference inventory returned', `${(response.result.references || []).length} individual references returned from the focused annotation response.`, 'reference-inventory:returned');
  state.referenceInventory = {
    status: 'ready',
    pages: response.result.pages || pages,
    blockCount: referenceBlocks.length,
    references: response.result.references || [],
    coverage: response.result.coverage || null,
    issues: [],
    error: ''
  };
  recordRuntime('Reference inventory accepted', `${response.result.coverage?.percent ?? '—'}% bibliography text coverage passed the passive contract check.`, 'reference-inventory:accepted');
  const references = (response.result.references || []).map((item, index) => ({
    link_handle: item.id,
    printed_label: item.printed_label,
    text: item.text,
    number: index + 1,
    body_occurrences: []
  }));
  state.annotations.references = { references };
  state.annotationStatus.references = 'ready';
  showReferenceCounts(state.annotations.references);
  finishDirectSourceLinks();
  recordRuntime('Reference inventory ready', `${references.length} individual references rendered as stable HTML targets.`, 'reference-inventory:ready');
}
function request(path, payload) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).then(async (response) => {
    const text = await response.text();
    try {
      return { response, result: text ? JSON.parse(text) : {} };
    } catch {
      return { response, result: { error: text.trim() || `Request failed (${response.status}).` } };
    }
  });
}
async function settled(promise) {
  try { return { status: 'fulfilled', value: await promise }; }
  catch (reason) { return { status: 'rejected', reason }; }
}
function closeDetails() { state.openDetailKind = ''; const panel = el('#detailsPanel'); panel.classList.remove('is-open'); panel.setAttribute('aria-hidden', 'true'); }
function sourceItems(kind) { const front = state.annotations['front-matter'] || {}; const body = state.annotations.body || {}; const refs = state.annotations.references || {}; if (['authors', 'affiliations', 'keywords'].includes(kind)) return front[kind] || []; if (kind === 'abstract') return Array.isArray(front.abstract?.prose_blocks) ? [front.abstract] : []; if (kind === 'article') return body.sections || []; if (kind === 'references') return refs.references || []; if (kind === 'tables' || kind === 'figures') return (body.display_items || []).filter((item) => item.kind === kind.slice(0, -1)); return []; }
function detailText(item, kind) { if (kind === 'article') return item.heading; if (kind === 'abstract') return `${item.word_count || 0} words`; if (kind === 'references') return item.text; if (kind === 'tables' || kind === 'figures') return item.label; return item.text; }
function detailPass(kind) { if (['authors', 'affiliations', 'abstract', 'keywords'].includes(kind)) return 'front-matter'; if (['article', 'tables', 'figures'].includes(kind)) return 'body'; if (kind === 'references') return 'references'; return null; }
function detailSummaryText(kind, count, itemCount) {
  if (kind === 'article') return count === '—' ? 'Article word count was not returned for this stored review.' : `${count} article words counted from the manuscript text.`;
  if (kind === 'abstract') return count === '—' ? 'Abstract word count was not returned for this stored review.' : `${count} abstract words counted from the manuscript text.`;
  return `${itemCount} ${labelFor(kind).toLowerCase()} item${itemCount === 1 ? '' : 's'} returned from the current document map.`;
}
function appendDetailStatus(container, text, pending = false) { const status = document.createElement('div'); status.className = `detail-link-status small text-secondary mt-2 d-flex align-items-center gap-2${pending ? ' is-pending' : ''}`; if (pending) status.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>'; const message = document.createElement('span'); message.className = pending ? 'detail-link-status-message' : ''; message.textContent = pending ? text.replace(/\.{3}$/, '') : text; if (pending) status.setAttribute('aria-label', text); status.append(message); container.append(status); }
function appendSourceLinksPending(container, kind) {
  const status = sourceLinkStatus(kind);
  if (!['tables', 'figures', 'references'].includes(kind) || ['ready', 'unavailable'].includes(status)) return;
  const pending = document.createElement('div');
  pending.className = 'details-pending d-flex align-items-center gap-3 mb-3';
  pending.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><div><div class="small fw-semibold text-body">Finding manuscript mentions</div><div class="small text-secondary mt-1">The count is ready. Body-text mentions and jump links will appear here shortly.</div></div>';
  container.append(pending);
}
function clearSourceHighlight() { document.querySelectorAll('.source-target-highlight').forEach((mark) => { const parent = mark.parentNode; parent.replaceChild(document.createTextNode(mark.textContent), mark); parent.normalize(); }); document.querySelectorAll('.ocr-reference-target, .ocr-page-source-target').forEach((target) => target.classList.remove('ocr-reference-target', 'ocr-page-source-target')); }
function highlightExactQuote(container, quote) { if (!quote) return null; const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { const offset = node.nodeValue.indexOf(quote); if (offset < 0) continue; const fragment = document.createDocumentFragment(); fragment.append(node.nodeValue.slice(0, offset)); const mark = document.createElement('mark'); mark.className = 'source-target-highlight'; mark.textContent = quote; fragment.append(mark, node.nodeValue.slice(offset + quote.length)); node.parentNode.replaceChild(fragment, node); return mark; } return null; }
function highlightSourceItem(container, anchorQuote, itemQuote) {
  if (!itemQuote) return null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node;
  const itemNodes = [];
  while ((node = walker.nextNode())) {
    if (node.nodeValue.includes(itemQuote)) itemNodes.push(node);
    if (!anchorQuote || !anchorQuote.includes(itemQuote)) continue;
    const anchorOffset = node.nodeValue.indexOf(anchorQuote);
    if (anchorOffset < 0) continue;
    const itemOffset = anchorQuote.indexOf(itemQuote);
    const offset = anchorOffset + itemOffset;
    const fragment = document.createDocumentFragment();
    fragment.append(node.nodeValue.slice(0, offset));
    const mark = document.createElement('mark');
    mark.className = 'source-target-highlight';
    mark.textContent = itemQuote;
    fragment.append(mark, node.nodeValue.slice(offset + itemQuote.length));
    node.parentNode.replaceChild(fragment, node);
    return mark;
  }
  if (itemNodes.length) {
    const anchorParts = String(anchorQuote || '').split(/\s*\n+\s*|\s{2,}/).map((part) => part.trim()).filter((part) => part && part !== itemQuote);
    const bestNode = itemNodes
      .map((candidate) => {
        const hostText = candidate.parentElement?.textContent || candidate.nodeValue;
        const score = anchorParts.reduce((sum, part) => sum + (hostText.includes(part) ? 1 : 0), 0);
        return { candidate, score };
      })
      .sort((left, right) => right.score - left.score)[0]?.candidate || itemNodes[0];
    return highlightExactQuote(bestNode.parentElement || container, itemQuote);
  }
  return null;
}
function clearSearchHighlights() { document.querySelectorAll('.manuscript-search-highlight').forEach((mark) => { const parent = mark.parentNode; parent.replaceChild(document.createTextNode(mark.textContent), mark); parent.normalize(); }); document.querySelectorAll('.pdf-page-search-target').forEach((target) => target.classList.remove('pdf-page-search-target')); }
function highlightSearchMatch(container, quote) { if (!quote) return null; const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { const offset = node.nodeValue.toLocaleLowerCase().indexOf(quote.toLocaleLowerCase()); if (offset < 0) continue; const fragment = document.createDocumentFragment(); fragment.append(node.nodeValue.slice(0, offset)); const mark = document.createElement('mark'); mark.className = 'manuscript-search-highlight'; mark.textContent = node.nodeValue.slice(offset, offset + quote.length); fragment.append(mark, node.nodeValue.slice(offset + quote.length)); node.parentNode.replaceChild(fragment, node); return mark; } return null; }
function searchablePageText(page = {}) { return [page.markdown || page.content || '', ...(page.blocks || []).map((block) => block.content || ''), ...(page.tables || []).map((table) => plain(table.content || ''))].filter(Boolean).join('\n'); }
function updateSearchControls() { const total = state.search.matches.length; const active = state.search.index + 1; el('#manuscriptSearchStatus').textContent = total ? `${active} / ${total}` : state.search.query ? 'No matches' : ''; el('#manuscriptSearchPrevious').disabled = !total; el('#manuscriptSearchNext').disabled = !total; }
function showSearchMatch() { const match = state.search.matches[state.search.index]; if (!match) return; clearSearchHighlights(); if (!pdfPane.classList.contains('d-none')) { scrollPdfToPage(match.pageNumber); const page = el(`.pdf-page[data-page="${match.pageNumber}"]`); page?.classList.add('pdf-page-search-target'); return; } const target = el(`.ocr-page[data-page="${match.pageNumber}"]`); const mark = highlightSearchMatch(target, match.text); if (mark) scrollHighlightedMark(mark); else target?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function updateManuscriptSearch(query = '') { const normalized = String(query || '').trim(); state.search.query = normalized; clearSearchHighlights(); if (!normalized || !state.raw?.pages?.length) { state.search.matches = []; state.search.index = -1; updateSearchControls(); return; } const needle = normalized.toLocaleLowerCase(); state.search.matches = state.raw.pages.flatMap((page, pageIndex) => { const text = searchablePageText(page); const lower = text.toLocaleLowerCase(); const matches = []; let offset = lower.indexOf(needle); while (offset !== -1) { matches.push({ pageNumber: pageIndex + 1, text: text.slice(offset, offset + normalized.length) }); offset = lower.indexOf(needle, offset + Math.max(1, needle.length)); } return matches; }); state.search.index = state.search.matches.length ? 0 : -1; updateSearchControls(); showSearchMatch(); }
function stepManuscriptSearch(direction) { const total = state.search.matches.length; if (!total) return; state.search.index = (state.search.index + direction + total) % total; updateSearchControls(); showSearchMatch(); }
function resetManuscriptSearch() { el('#pdfSearchInput').value = ''; updateManuscriptSearch(''); }
function findReferenceTarget(item) { const entries = [...document.querySelectorAll('.ocr-reference-list li')]; const handle = String(item?.link_handle || ''); if (handle) { const handled = entries.find((entry) => entry.dataset.referenceHandle === handle); if (handled) return handled; } const number = String(item?.number || ''); if (number) { const numbered = entries.find((entry) => entry.dataset.referenceNumber === number); if (numbered) return numbered; } const text = plain(item?.text || '').replace(/\s+/g, ' ').trim(); return entries.find((entry) => entry.dataset.referenceText === text) || entries.find((entry) => text && entry.dataset.referenceText.includes(text)); }
function jumpToSource(item, kind = '') { setMode('html'); clearSourceHighlight(); if (kind === 'references') { const referenceTarget = findReferenceTarget(item); if (!referenceTarget) return; const mark = highlightExactQuote(referenceTarget, plain(item?.text || '').replace(/\s+/g, ' ').trim()); if (mark) scrollHighlightedMark(mark); else referenceTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); referenceTarget.classList.add('ocr-reference-target'); window.setTimeout(() => referenceTarget?.classList.remove('ocr-reference-target'), 1800); return; } const source = resolveSource(item); if (!source) return; const target = el(`.ocr-page[data-page="${source.pageNumber}"]`); const mark = source.canHighlight ? highlightSourceItem(target, source.anchorQuote, source.itemQuote) : null; if (mark) scrollHighlightedMark(mark); else { target?.scrollIntoView({ behavior: 'smooth', block: 'start' }); target?.classList.add('ocr-page-source-target'); window.setTimeout(() => target?.classList.remove('ocr-page-source-target'), 1400); } }
function profileForAuthor(index) { return state.authorProfiles.authors[index] || null; }
function appendAuthorProfileLinks(card, author, profile) {
  const links = document.createElement('div');
  links.className = 'd-flex flex-wrap align-items-center gap-2 mt-2';
  const appendLink = (href, icon, label, kind) => {
    if (!href) return;
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'author-detail-link link-secondary text-decoration-none';
    link.dataset.authorProfileLink = kind;
    link.innerHTML = `<i class="bi ${icon} me-1" aria-hidden="true"></i>${label}`;
    links.append(link);
  };
  appendLink(profile?.openAlexUrl, 'bi-mortarboard', 'OpenAlex', 'openalex');
  appendLink(profile?.orcidUrl, 'bi-person-badge', 'ORCID', 'orcid');
  if (!profile?.openAlexUrl && !profile?.orcidUrl) appendLink(profile?.googleScholarUrl || googleScholarUrl(author.text), 'bi-search', 'Find in Google Scholar', 'google-scholar');
  if (profile?.status === 'found' && (profile.worksCount || profile.citedByCount)) {
    const meta = document.createElement('span');
    meta.className = 'small text-secondary';
    meta.textContent = `${profile.worksCount || 0} works · ${profile.citedByCount || 0} citations`;
    links.append(meta);
  }
  card.append(links);
}
function appendAuthorProfilePending(container) {
  if (state.authorProfiles.status !== 'loading') return;
  const pending = document.createElement('div');
  pending.className = 'small text-secondary d-flex align-items-center gap-2 mb-3';
  pending.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>Looking up external author profiles...</span>';
  container.append(pending);
}
function appendAbstractDetail(list, item) {
  const source = resolveSource(item);
  const text = item.word_count_provenance || wordCountProvenanceFromBlocks(state.raw?.pages || [], item.prose_blocks || []);
  const container = document.createElement('div');
  container.className = 'detail-source-surface';
  if (source) {
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'detail-jump border-0 text-start w-100 p-0 bg-transparent';
    const label = document.createElement('div');
    label.className = 'small fw-semibold text-body mb-2';
    label.textContent = 'What was counted';
    jump.append(label);
    jump.addEventListener('click', () => jumpToSource(item, 'abstract'));
    container.append(jump);
  } else {
    const label = document.createElement('div');
    label.className = 'small fw-semibold text-body mb-2';
    label.textContent = 'What was counted';
    container.append(label);
  }
  if (text.valid) {
    text.fragments.forEach((fragment) => {
      const paragraph = document.createElement('p');
      paragraph.className = 'small text-secondary mb-2';
      paragraph.textContent = fragment;
      container.append(paragraph);
    });
    list.append(container);
    return;
  }
  const fallback = document.createElement('div');
  fallback.className = 'small text-secondary';
  fallback.textContent = 'The exact abstract source blocks were not returned for this review.';
  container.append(fallback);
  list.append(container);
}
function appendArticleCountDetails(container) {
  const provenance = state.annotations.body?.word_count_provenance;
  if (!provenance?.valid) return false;
  const card = document.createElement('div');
  card.className = 'detail-source-surface mb-2';
  const heading = document.createElement('div');
  heading.className = 'small fw-semibold text-body mb-2';
  heading.textContent = 'What was counted';
  const meta = document.createElement('div');
  meta.className = 'small text-secondary mb-2';
  meta.textContent = `${provenance.count} words counted from ${provenance.block_ids.length} model-selected OCR block${provenance.block_ids.length === 1 ? '' : 's'}.`;
  card.append(heading, meta);
  provenance.fragments.forEach((fragment) => {
    const paragraph = document.createElement('p');
    paragraph.className = 'small text-secondary mb-2';
    paragraph.textContent = fragment;
    card.append(paragraph);
  });
  container.append(card);
  return true;
}
function appendDetailItem(list, item, kind, index) {
  if (kind === 'abstract') {
    appendAbstractDetail(list, item);
    return;
  }
  const source = resolveSource(item);
  const linked = kind === 'references' ? Boolean(item.link_handle) : Boolean(source);
  if (kind !== 'authors') {
    const hasOccurrences = ['tables', 'figures', 'references'].includes(kind) && Array.isArray(item.body_occurrences);
    const container = hasOccurrences ? document.createElement('div') : null;
    if (container) container.className = 'detail-source-surface';
    const row = document.createElement(linked ? 'button' : 'div');
    if (linked) row.type = 'button';
    row.className = hasOccurrences ? `${linked ? 'detail-jump border-0 text-start w-100 p-0 bg-transparent' : 'detail-source-unavailable'}` : `detail-source-surface ${linked ? 'detail-jump border-0 text-start' : 'detail-source-unavailable'}`;
    const text = document.createElement('div');
    text.className = 'detail-source-text';
    text.textContent = detailText(item, kind);
    row.append(text);
    if (linked) row.addEventListener('click', () => jumpToSource(item, kind)); else appendDetailStatus(row, 'This item is available, but its exact source link could not be confirmed.');
    if (!container) { list.append(row); return; }
    container.append(row);
    const occurrences = (item.body_occurrences || []).filter((occurrence) => resolveSource({ source: occurrence.source }));
    const linksStatus = sourceLinkStatus(kind);
    if (linksStatus !== 'ready') {
      appendDetailStatus(container, linksStatus === 'unavailable' ? 'Manuscript-use links are currently unavailable.' : 'Finding body-text mentions...', linksStatus !== 'unavailable');
      list.append(container);
      return;
    }
    const heading = document.createElement('div');
    heading.className = 'small text-secondary border-top mt-3 pt-2 mb-1';
    heading.textContent = `${occurrences.length} occurrence${occurrences.length === 1 ? '' : 's'} in the body text`;
    container.append(heading);
    occurrences.forEach((occurrence) => {
      const occurrenceRow = document.createElement('button');
      occurrenceRow.type = 'button';
      occurrenceRow.className = 'detail-occurrence-jump border-0 bg-transparent text-start w-100 px-0 py-2';
      const context = document.createElement('div');
      context.className = 'small text-secondary';
      context.textContent = occurrence.context_quote;
      if (occurrence.citation_text && occurrence.citation_text !== occurrence.context_quote) {
        const citation = document.createElement('div');
        citation.className = 'small fw-semibold text-body';
        citation.textContent = occurrence.citation_text;
        context.classList.add('mt-1');
        occurrenceRow.append(citation);
      }
      occurrenceRow.append(context);
      occurrenceRow.addEventListener('click', () => jumpToSource({ source: occurrence.source, item_exact_quote: occurrence.citation_text }, ''));
      container.append(occurrenceRow);
    });
    list.append(container);
    return;
  }
  const card = document.createElement('div');
  card.className = 'author-detail-card detail-source-surface';
  const sourceRow = document.createElement(linked ? 'button' : 'div');
  if (linked) sourceRow.type = 'button';
  sourceRow.className = linked ? 'detail-jump border-0 text-start w-100 p-0 bg-transparent' : 'detail-source-unavailable';
  const text = document.createElement('div');
  text.className = 'detail-source-text';
  text.textContent = detailText(item, kind);
  sourceRow.append(text);
  if (source) sourceRow.addEventListener('click', () => jumpToSource(item, kind)); else appendDetailStatus(sourceRow, 'This item is available, but its exact source link could not be confirmed.');
  card.append(sourceRow);
  if (state.authorProfiles.status !== 'loading') appendAuthorProfileLinks(card, item, profileForAuthor(index));
  list.append(card);
}
function appendAffiliationSourceRow(card, item) {
  const source = resolveSource(item);
  const row = document.createElement(source ? 'button' : 'div');
  if (source) row.type = 'button';
  row.className = source ? 'detail-jump border-0 text-start w-100 p-0 bg-transparent' : 'detail-source-unavailable';
  const text = document.createElement('div');
  text.className = 'detail-source-text';
  text.textContent = item.text;
  row.append(text);
  if (source) {
    row.addEventListener('click', () => jumpToSource(item, 'affiliations'));
  } else appendDetailStatus(row, 'This item is available, but its exact source link could not be confirmed.');
  card.append(row);
}
function setAffiliationFilter(body, filter = 'all') {
  state.affiliationFilter = filter === 'issues' ? 'issues' : 'all';
  body.querySelectorAll('[data-affiliation-linkage-card]').forEach((card) => {
    const visible = state.affiliationFilter === 'all'
      ? card.dataset.affiliationLinkageType === 'affiliation'
      : card.dataset.affiliationLinkageIssue === 'true';
    card.classList.toggle('d-none', !visible);
  });
  const action = body.querySelector('[data-affiliation-filter-action]');
  if (action) action.textContent = state.affiliationFilter === 'issues' ? 'Show all affiliations' : 'Show linking issues';
}
function appendAffiliationDetails(body) {
  const linkage = projectAffiliationLinkage(state.annotations['front-matter'] || {});
  if (!linkage.available) return false;
  const authorTotal = linkage.authors.length;
  const affiliationTotal = linkage.affiliations.length;
  const allLinked = linkage.authorLinked === authorTotal && linkage.affiliationLinked === affiliationTotal;
  const summary = document.createElement('div');
  summary.className = `alert ${allLinked ? 'alert-success' : 'alert-light border'} d-flex align-items-center gap-2 py-2 px-3 small mb-2`;
  summary.innerHTML = `<i class="bi ${allLinked ? 'bi-check-circle-fill' : 'bi-link-45deg'} flex-shrink-0" aria-hidden="true"></i><span>${allLinked ? `All ${authorTotal} author${authorTotal === 1 ? '' : 's'} linked to an affiliation and all ${affiliationTotal} affiliation${affiliationTotal === 1 ? '' : 's'} linked to an author.` : `${linkage.authorLinked}/${authorTotal} authors linked to an affiliation; ${linkage.affiliationLinked}/${affiliationTotal} affiliations linked to an author.`}</span>`;
  body.append(summary);
  const unlinkedAuthors = linkage.authors.filter((author) => !author.linkedAffiliationIndexes.length);
  const unlinkedAffiliations = linkage.affiliations.filter((affiliation) => !affiliation.linkedAuthorIndexes.length);
  if (unlinkedAuthors.length || unlinkedAffiliations.length) {
    const issue = document.createElement('div');
    issue.className = 'alert alert-warning d-flex align-items-center justify-content-between gap-3 py-2 px-3 mb-2 w-100';
    issue.innerHTML = `<div class="d-flex align-items-center gap-2 min-w-0"><i class="bi bi-exclamation-triangle-fill flex-shrink-0" aria-hidden="true"></i><span class="small fw-semibold">Affiliation linking issues found (${unlinkedAuthors.length + unlinkedAffiliations.length})</span></div>`;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn btn-sm btn-outline-warning flex-shrink-0';
    action.dataset.affiliationFilterAction = '';
    action.textContent = 'Show linking issues';
    action.addEventListener('click', () => setAffiliationFilter(body, state.affiliationFilter === 'issues' ? 'all' : 'issues'));
    issue.append(action);
    body.append(issue);
  }
  const list = document.createElement('div');
  list.className = 'vstack gap-2';
  linkage.affiliations.forEach((affiliation) => {
    const card = document.createElement('div');
    const hasIssue = !affiliation.linkedAuthorIndexes.length;
    card.className = 'detail-source-surface affiliation-detail-card';
    card.dataset.affiliationLinkageCard = '';
    card.dataset.affiliationLinkageType = 'affiliation';
    card.dataset.affiliationLinkageIssue = String(hasIssue);
    appendAffiliationSourceRow(card, affiliation);
    const linked = document.createElement('div');
    linked.className = 'mt-3';
    const label = document.createElement('div');
    label.className = 'small text-secondary mb-2';
    label.textContent = 'Linked authors';
    linked.append(label);
    if (affiliation.linkedAuthors.length) {
      const badges = document.createElement('div');
      badges.className = 'd-flex flex-wrap gap-1';
      affiliation.linkedAuthors.forEach((author) => { const badge = document.createElement('span'); badge.className = 'badge rounded-pill bg-body-secondary text-body fw-normal'; badge.textContent = author.text; badges.append(badge); });
      linked.append(badges);
    } else {
      const message = document.createElement('div');
      message.className = 'small text-warning-emphasis';
      message.textContent = 'No linked authors were returned for this affiliation.';
      linked.append(message);
    }
    card.append(linked);
    list.append(card);
  });
  unlinkedAuthors.forEach((author) => {
    const card = document.createElement('div');
    card.className = 'detail-source-surface affiliation-detail-card d-none';
    card.dataset.affiliationLinkageCard = '';
    card.dataset.affiliationLinkageType = 'author';
    card.dataset.affiliationLinkageIssue = 'true';
    appendAffiliationSourceRow(card, author);
    const message = document.createElement('div');
    message.className = 'small text-warning-emphasis mt-2';
    message.textContent = 'No affiliation was returned for this author.';
    card.append(message);
    list.append(card);
  });
  body.append(list);
  setAffiliationFilter(body, 'all');
  return true;
}
function openDetails(kind) {
  state.openDetailKind = kind;
  const tile = el(`[data-count="${kind}"]`);
  const count = tile?.querySelector('strong')?.textContent || '—';
  const items = sourceItems(kind);
  const pass = detailPass(kind);
  const passPending = pass && state.annotationStatus[pass] === 'pending';
  const currentState = categoryState(kind);
  const body = el('#detailsPanelBody');
  body.replaceChildren();
  const heading = document.createElement('h2');
  heading.className = 'h6 mb-3 pb-2 border-bottom';
  heading.textContent = `${kind[0].toUpperCase()}${kind.slice(1)}`;
  body.append(heading);
  if (tile?.classList.contains('is-loading') || ['waiting', 'extracting'].includes(currentState)) {
    const pending = document.createElement('div');
    pending.className = 'details-pending d-flex align-items-center gap-3';
    pending.innerHTML = kind === 'references'
      ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><div><div class="small fw-semibold text-body">Separating individual references</div><div class="small text-secondary mt-1">The manuscript is ready. References and their HTML source links will appear here shortly.</div></div>'
      : '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><div><div class="small fw-semibold text-body">Preparing this result</div><div class="small text-secondary mt-1">The reader is ready. This result will appear as soon as its annotation range is available.</div></div>';
    body.append(pending);
  } else {
    const summary = document.createElement('div');
    summary.className = 'alert alert-light border py-2 px-3 small mb-3';
    summary.textContent = detailSummaryText(kind, count, items.length);
    body.append(summary);
    appendSourceLinksPending(body, kind);
    if (kind === 'authors') appendAuthorProfilePending(body);
    if (kind === 'article') appendArticleCountDetails(body);
    if (kind === 'affiliations' && appendAffiliationDetails(body)) {
      // The model-authored linkage view supplies its own cards.
    } else if (!items.length) {
      const source = document.createElement('div');
      source.className = 'detail-source-surface';
      source.textContent = passPending ? 'Preparing this result...' : 'No item details were returned for this result.';
      body.append(source);
    } else {
      const list = document.createElement('div');
      list.className = 'vstack gap-2';
      items.forEach((item, index) => appendDetailItem(list, item, kind, index));
      body.append(list);
    }
  }
  const panel = el('#detailsPanel');
  panel.classList.add('is-open');
  panel.setAttribute('aria-hidden', 'false');
}

function revealAnnotationProgress() {
  const references = state.annotations.references || { references: [] };
  const staged = projectAnnotationChunks(state.annotationChunks, { pages: state.raw?.pages || [] });
  state.annotationCandidates = staged.candidates;
  state.annotations = projectAnnotation(staged.annotation);
  state.annotations.references = references;
  const front = state.annotations['front-matter'];
  if (front.authors?.length || front.affiliations?.length || front.keywords?.length || front.abstract?.source || Array.isArray(front.abstract?.prose_blocks)) showFrontMatterCounts(front);
  const body = state.annotations.body;
  if (body.sections?.length || body.prose_blocks?.length || body.article_text_ranges?.length || body.display_items?.length) showBodyCounts(body);
}

function finishDirectSourceLinks() {
  ['affiliations', 'abstract', 'keywords'].forEach((kind) => { if (!el(`[data-count="${kind}"]`)?.classList.contains('is-loading')) { if (categoryState(kind) !== 'unavailable') setCategoryState(kind, 'ready'); setTileProgress(kind, 100, categoryState(kind) === 'unavailable' ? 'Unavailable' : 'Ready'); if (categoryState(kind) !== 'unavailable') recordSourceLinksReady(kind); } });
  const articleTile = el('[data-count="article"]');
  if (articleTile && !articleTile.classList.contains('is-loading')) {
    const available = articleTile.querySelector('strong')?.textContent !== '—';
    setCategoryState('article', available ? 'ready' : 'unavailable');
    setTileProgress('article', 100, available ? 'Ready' : 'Article text unavailable');
    if (available) recordSourceLinksReady('article');
  }
  if (state.authorProfiles.status !== 'loading' && !el('[data-count="authors"]')?.classList.contains('is-loading')) { if (categoryState('authors') !== 'unavailable') setCategoryState('authors', 'ready'); setTileProgress('authors', 100, categoryState('authors') === 'unavailable' ? 'Unavailable' : 'Ready'); if (categoryState('authors') !== 'unavailable') recordSourceLinksReady('authors'); }
  const referenceTile = el('[data-count="references"]');
  if (referenceTile && !referenceTile.classList.contains('is-loading')) {
    if (categoryState('references') === 'unavailable') {
      setTileProgress('references', 0, 'Unavailable');
      return;
    }
    const references = sourceItems('references');
    const linksReady = state.referenceLinksStatus === 'ready';
    const linksPending = state.referenceLinksStatus === 'pending';
    setCategoryState('references', linksPending ? 'linking' : linksReady ? 'ready' : 'counted');
    setTileProgress('references', linksReady ? 100 : 76, linksReady ? 'Ready' : linksPending ? 'Finding body citations' : 'Count ready');
    if (linksReady) recordSourceLinksReady('references');
  }
}

async function runBodyCitationStage(base64) {
  const ranges = bodyCitationBlockRanges(state.annotationChunks, state.raw?.pages || []);
  state.citationExtraction = { status: 'pending', ranges: [], candidates: [] };
  recordRuntime(
    'Body citation extraction started',
    `${ranges.length} bounded article-page range${ranges.length === 1 ? '' : 's'} scheduled.`,
    'body-citations:start',
    { rangeCount: ranges.length }
  );
  if (!ranges.length) {
    state.citationExtraction.status = 'unavailable';
    recordRuntime('Body citation extraction unavailable', 'Broad annotation returned no article-page scope.', 'body-citations:unavailable');
    return;
  }
  if (ranges.length > MAX_CITATION_REQUESTS_PER_MANUSCRIPT) {
    state.citationExtraction.status = 'unavailable';
    recordRuntime(
      'Body citation extraction unavailable',
      `${ranges.length} bounded requests would exceed the ${MAX_CITATION_REQUESTS_PER_MANUSCRIPT}-request manuscript budget.`,
      'body-citations:unavailable',
      { rangeCount: ranges.length, requestBudget: MAX_CITATION_REQUESTS_PER_MANUSCRIPT }
    );
    return;
  }
  const records = [];
  const failures = [];
  for (const [index, range] of ranges.entries()) {
    const { pages, blocks } = range;
    try {
      const response = await request('/api/ocr/citations', JSON.stringify({ base64, citationBlocks: blocks }));
      if (!response.response.ok) {
        records.push({
          range_id: `citation-range-${index}`,
          pages,
          supplied_blocks: blocks,
          citation_blocks: response.result?.diagnostics?.citationBlocks ?? null,
          citation_mentions: response.result?.diagnostics?.citationMentions || [],
          issues: response.result?.issues || []
        });
        const error = new Error(response.result?.error || 'Body citation extraction was unavailable.');
        error.failureType = Array.isArray(response.result?.issues) && response.result.issues.length ? 'validation_failed' : 'request_unavailable';
        throw error;
      }
      records.push({
        range_id: `citation-range-${index}`,
        pages,
        supplied_blocks: blocks,
        citation_blocks: response.result.citationBlocks,
        citation_mentions: response.result.citationMentions,
        issues: []
      });
      recordRuntime(
        'Body citation range ready',
        `Pages ${pages[0] + 1}-${pages.at(-1) + 1}: ${response.result.citationMentions.length} citation occurrences returned from ${blocks.length} article blocks.`,
        `body-citations:range:${pages[0]}`
      );
    } catch (error) {
      failures.push({ range_id: `citation-range-${index}`, pages, blocks, type: error?.failureType || 'request_unavailable', message: error?.message || 'Body citation extraction was unavailable.' });
      recordRuntime('Body citation range unavailable', `Pages ${pages[0] + 1}-${pages.at(-1) + 1}.`, `body-citations:range:${pages[0]}`);
    }
  }
  const grounded = bindCitationAnnotationRanges(records, state.raw?.pages || []);
  const groundedById = new Map(grounded.ranges.map((range) => [range.id, range]));
  const failedRanges = failures.map((failure) => {
    const diagnosticRange = groundedById.get(failure.range_id);
    if (diagnosticRange) {
      return {
        ...diagnosticRange,
        reasonCounts: { ...diagnosticRange.reasonCounts, [failure.type]: 1 },
        failureMessage: failure.message
      };
    }
    return {
      id: failure.range_id,
      pages: failure.pages,
      returned: 0,
      accepted: 0,
      rejected: 0,
      reasonCounts: { [failure.type]: 1 },
      failureMessage: failure.message,
      suppliedBlocks: failure.blocks,
      blockResults: null,
      issues: [],
      items: []
    };
  });
  const failedIds = new Set(failures.map((failure) => failure.range_id));
  const acceptedCandidates = grounded.candidates;
  state.citationExtraction = {
    // A failed or ungrounded occurrence must never be mapped, but it must not
    // erase independently grounded occurrences from other blocks or ranges.
    status: acceptedCandidates.length ? 'ready' : 'unavailable',
    ranges: [...grounded.ranges.filter((range) => !failedIds.has(range.id)), ...failedRanges].sort((first, second) => (first.pages[0] ?? 0) - (second.pages[0] ?? 0)),
    candidates: acceptedCandidates
  };
  state.annotationCandidates = {
    ...(state.annotationCandidates || {}),
    citation_mentions: state.citationExtraction.candidates
  };
  const returned = grounded.ranges.reduce((total, range) => total + range.returned, 0);
  const rejected = grounded.ranges.reduce((total, range) => total + range.rejected, 0);
  if (failures.length && !acceptedCandidates.length) {
    const validationFailures = failures.filter((failure) => failure.type === 'validation_failed').length;
    const serviceFailures = failures.length - validationFailures;
    const reasons = [
      validationFailures ? `${validationFailures} failed exact-source validation` : '',
      serviceFailures ? `${serviceFailures} could not be completed` : ''
    ].filter(Boolean).join('; ');
    recordRuntime('Body citation extraction unavailable', `${failures.length}/${ranges.length} bounded ranges failed (${reasons}); Document QnA reference mapping was not started.`, 'body-citations:unavailable');
  } else {
    const partialDetail = failures.length
      ? ` ${failures.length}/${ranges.length} bounded range${failures.length === 1 ? '' : 's'} did not yield usable anchors; only independently grounded occurrences proceed to mapping.`
      : '';
    recordRuntime('Body citation extraction ready', `${returned} returned; ${acceptedCandidates.length} grounded; ${rejected} rejected.${partialDetail}`, 'body-citations:ready', {
      returned,
      accepted: acceptedCandidates.length,
      rejected,
      failedRanges: failures.length
    });
  }
}

async function startReferenceLinks() {
  const references = state.annotations.references?.references || [];
  const citationMentions = state.annotationCandidates?.citation_mentions || [];
  if (!references.length) return;
  const candidates = {
    references: references.map((item) => ({ handle: item.link_handle, printed_label: String(item.printed_label || ''), text: item.text })),
    citation_mentions: citationMentions
  };
  state.documentQna.references = {
    status: 'pending',
    inputs: { references: references.length, bodyCitations: citationMentions.length },
    links: null
  };
  recordRuntime(
    'Reference link inputs prepared',
    `${references.length} references and ${citationMentions.length} source-grounded body citation groups are available.`,
    'reference-links:inputs',
    { referenceCount: references.length, citationMentionCount: citationMentions.length }
  );
  state.referenceLinksStatus = 'pending';
  setCategoryState('references', 'linking');
  setTileProgress('references', 76, 'Finding body citations');
  refreshOpenDetails(['references']);
  if (!citationMentions.length) {
    const citationRanges = state.citationExtraction?.ranges || [];
    const extractionSummary = citationRanges.reduce((summary, range) => ({
      returned: summary.returned + (range.returned || 0),
      accepted: summary.accepted + (range.accepted || 0),
      rejected: summary.rejected + (range.rejected || 0)
    }), { returned: 0, accepted: 0, rejected: 0 });
    const extractionFailed = state.citationExtraction?.status === 'unavailable' && extractionSummary.returned > 0;
    const unavailableDetail = extractionFailed
      ? `Body citation extraction returned ${extractionSummary.returned} occurrences, but its bounded requests did not all pass exact-source validation. Document QnA was not started.`
      : 'Document annotation returned 0 body citation groups, so no relation request was sent.';
    state.referenceLinksStatus = 'unavailable';
    setCategoryState('references', 'counted', extractionFailed ? 'The reference count is final; body citation extraction did not pass exact-source validation.' : 'The reference count is final; document annotation returned no body citation groups.');
    setTileProgress('references', 76, 'Citation links unavailable');
    recordRuntime(
      'Reference links unavailable',
      unavailableDetail,
      'reference-links:unavailable',
      { reason: extractionFailed ? 'citation_extraction_failed_validation' : 'no_citation_mentions', ...extractionSummary }
    );
    state.documentQna.references = { ...state.documentQna.references, status: 'unavailable', message: extractionFailed ? `${extractionSummary.accepted} citation passages passed individually, but at least one bounded response failed validation, so no partial relation mapping was attempted.` : 'No source-verified body citations were available for mapping.' };
    refreshOpenDetails(['references']);
    return;
  }
  recordRuntime('Reference links started', `${citationMentions.length} source-grounded body citation groups are being matched to ${references.length} references.`, 'reference-links:start');
  try {
    const result = await request('/api/ocr/reference-links', JSON.stringify({ candidates }));
    if (!result.response.ok) throw new Error(result.result?.error || 'Reference links were unavailable.');
    state.annotations.references.references = applyReferenceLinks(references, candidates, result.result.links);
    state.documentQna.references = { ...state.documentQna.references, status: 'ready', links: result.result.links };
    state.referenceLinksStatus = 'ready';
    setCategoryState('references', 'ready');
    setTileProgress('references', 100, 'Ready');
    recordRuntime('Reference links ready', 'Body-text citation mappings returned and validated.', 'reference-links:ready');
  } catch {
    state.documentQna.references = { ...state.documentQna.references, status: 'unavailable', message: 'The reference relation response was unavailable or invalid.' };
    state.referenceLinksStatus = 'unavailable';
    setCategoryState('references', 'counted', 'The reference count is final; body-text citation links are unavailable.');
    setTileProgress('references', 76, 'Citation links unavailable');
    recordRuntime('Reference links unavailable', 'Bibliography jump links remain available.', 'reference-links:unavailable');
  }
  refreshOpenDetails(['references']);
}

async function startSourceLinks(base64) {
  const candidates = state.annotationCandidates;
  if (!candidates || !state.raw?.pages?.length) return;
  const jobs = [];
  if (candidates.displays?.length) jobs.push({
    label: 'Display source links',
    kinds: ['tables', 'figures'],
    candidates: { displays: candidates.displays || [], display_mentions: candidates.display_mentions || [] }
  });
  const managedKinds = ['tables', 'figures'];
  if (!jobs.length) { setSourceLinkStatus(managedKinds, 'ready'); managedKinds.forEach((kind) => { if (categoryState(kind) !== 'unavailable') setCategoryState(kind, 'ready'); setTileProgress(kind, 100, categoryState(kind) === 'unavailable' ? 'Unavailable' : 'Ready'); }); finishDirectSourceLinks(); return; }
  const jobKinds = new Set(jobs.flatMap((job) => job.kinds));
  managedKinds.filter((kind) => !jobKinds.has(kind)).forEach((kind) => {
    setSourceLinkStatus([kind], 'ready');
    if (categoryState(kind) !== 'unavailable') setCategoryState(kind, 'ready');
    setTileProgress(kind, 100, categoryState(kind) === 'unavailable' ? 'Unavailable' : 'Ready');
  });
  recordRuntime('Display links started', 'Mistral is checking table and figure mentions.', 'display-links');
  for (const job of jobs) {
    const qnaRecord = { status: 'pending', inputs: { displays: job.candidates.displays.length, bodyMentions: job.candidates.display_mentions.length }, links: null };
    state.documentQna.displays.push(qnaRecord);
    setSourceLinkStatus(job.kinds, 'pending');
    job.kinds.forEach((kind) => { if (!el(`[data-count="${kind}"]`)?.classList.contains('is-loading')) { setCategoryState(kind, 'linking'); setTileProgress(kind, 76, 'Preparing manuscript links'); } });
    refreshOpenDetails(job.kinds);
    try {
      const result = await request('/api/ocr/display-links', JSON.stringify({ candidates: job.candidates }));
      if (!result.response.ok) throw new Error(result.result?.error || 'Source links were unavailable.');
      state.annotations = applySourceLinks(state.annotations, job.candidates, result.result.links);
      Object.assign(qnaRecord, { status: 'ready', links: result.result.links });
      setSourceLinkStatus(job.kinds, 'ready');
      job.kinds.forEach((kind) => { setCategoryState(kind, 'ready'); setTileProgress(kind, 100, 'Ready'); recordSourceLinksReady(kind); });
      recordRuntime(`${job.label} ready`, 'Mistral mappings returned and validated.', `display-links:${job.kinds.join('-')}`);
    } catch {
      Object.assign(qnaRecord, { status: 'unavailable', message: 'The display relation response was unavailable or invalid.' });
      setSourceLinkStatus(job.kinds, 'unavailable');
      job.kinds.forEach((kind) => { if (!el(`[data-count="${kind}"]`)?.classList.contains('is-loading')) { setCategoryState(kind, 'counted', 'The count is final; manuscript-use links are unavailable.'); setTileProgress(kind, 72, 'Links unavailable'); } });
      recordRuntime(`${job.label} unavailable`, 'Direct source locations remain available.', `display-links:${job.kinds.join('-')}`);
    }
    refreshOpenDetails(job.kinds);
  }
  finishDirectSourceLinks();
}
function startAuthorProfileLookup(authors = []) {
  const validAuthors = authors
    .map((author) => ({ ...author, text: String(author?.text || author?.label || author?.name || '').trim() }))
    .filter((author) => author.text);
  const token = ++state.authorProfileToken;
  if (!validAuthors.length) { state.authorProfiles = { status: 'idle', authors: [] }; return; }
  state.authorProfiles = { status: 'loading', authors: [] };
  if (state.openDetailKind === 'authors') openDetails('authors');
  recordRuntime('Author profile lookup started', `${validAuthors.length} authors sent to OpenAlex.`, 'author-profiles:start');
  request('/api/author-profiles', JSON.stringify({ authors: validAuthors.map(({ text, orcid = '' }) => ({ text, orcid })) }))
    .then(({ response, result }) => {
      if (token !== state.authorProfileToken) return;
      if (!response.ok) throw new Error(result?.error || 'Author profile lookup failed.');
      const profiles = Array.isArray(result?.authors) ? result.authors : [];
      state.authorProfiles = { status: 'ready', authors: profiles };
      setTileProgress('authors', 100, 'Ready');
      persistAuthorProfiles(profiles);
      recordRuntime('Author profile lookup ready', `${profiles.filter((profile) => profile.status === 'found').length}/${validAuthors.length} OpenAlex profiles found.`, 'author-profiles:ready');
      if (state.openDetailKind === 'authors') openDetails('authors');
    })
    .catch(() => {
      if (token !== state.authorProfileToken) return;
      state.authorProfiles = { status: 'unavailable', authors: [] };
      setTileProgress('authors', 100, 'Ready');
      persistAuthorProfiles([]);
      recordRuntime('Author profile lookup unavailable', 'Google Scholar search links remain available.', 'author-profiles:unavailable');
      if (state.openDetailKind === 'authors') openDetails('authors');
    });
}
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
    const pageContainer = document.createElement('div'); pageContainer.className = 'pdf-page'; pageContainer.dataset.page = String(pageNumber); pageContainer.style.width = `${viewport.width}px`;
    const canvas = document.createElement('canvas'); const context = canvas.getContext('2d', { alpha: false });
    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.className = 'pdf-page-canvas'; canvas.width = Math.floor(viewport.width * deviceScale); canvas.height = Math.floor(viewport.height * deviceScale); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    const textLayer = document.createElement('div'); textLayer.className = 'pdf-text-layer';
    pageContainer.append(canvas); pdfCanvasHost.append(pageContainer);
    pageContainer.append(textLayer);
    const renderedText = new TextLayer({
      textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
      container: textLayer,
      viewport
    }).render();
    await Promise.all([
      page.render({ canvasContext: context, viewport, transform: deviceScale === 1 ? null : [deviceScale, 0, 0, deviceScale, 0, 0] }).promise,
      renderedText
    ]);
    if (token !== state.pdfRenderToken) return;
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
async function runAnnotationStages(base64, { beforeRemainingRanges } = {}) {
  state.annotationCoverage = createAnnotationRunManifest(state.raw?.pages?.length || 0);
  state.annotationStatus = { ...state.annotationStatus, 'front-matter': 'pending', body: 'pending' };
  const failures = [];
  const processRange = async (range) => {
    const pages = range.pages;
    try {
      const response = await request('/api/ocr/annotate', JSON.stringify({ base64, pages, sourcePageMap: documentAnnotationSourcePageMap(state.raw?.pages || [], pages) }));
      if (!response.response.ok) throw new Error(response.result?.error || 'Document annotation was unavailable.');
      state.annotationChunks.push({ range_id: range.id, pages, annotation: response.result.annotation });
      state.annotationCoverage = markAnnotationRange(state.annotationCoverage, pages, 'completed');
      revealAnnotationProgress();
      recordRuntime('Annotation pages ready', `Pages ${pages[0] + 1}-${pages.at(-1) + 1} returned.`, `annotation:${pages[0]}`);
    } catch (error) {
      failures.push({ pages, message: error?.message || 'Document annotation was unavailable.' });
      state.annotationCoverage = markAnnotationRange(state.annotationCoverage, pages, 'failed');
      recordRuntime('Annotation pages unavailable', `Pages ${pages[0] + 1}-${pages.at(-1) + 1}: ${error?.message || 'Document annotation was unavailable.'}`, `annotation:${pages[0]}`);
      revealAnnotationProgress();
    }
  };
  const ranges = state.annotationCoverage.ranges;
  if (ranges.length) {
    await processRange(ranges[0]);
    if (typeof beforeRemainingRanges === 'function') await beforeRemainingRanges();
  }
  if (ranges.length > 1) {
    const remaining = ranges.slice(1);
    let nextRange = 0;
    const worker = async () => {
      while (nextRange < remaining.length) {
        const range = remaining[nextRange];
        nextRange += 1;
        await processRange(range);
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, remaining.length) }, () => worker()));
  }
  const complete = annotationManifestIsComplete(state.annotationCoverage);
  state.annotationStatus = complete
    ? { ...state.annotationStatus, 'front-matter': 'ready', body: 'ready' }
    : { ...state.annotationStatus, 'front-matter': state.annotationChunks.length ? 'ready' : 'unavailable', body: 'unavailable' };
  revealAnnotationProgress();
  finishDirectSourceLinks();
  settlePendingCounts();
  if (!state.annotationChunks.length) throw new Error(failures[0]?.message || 'Document annotation was unavailable.');
  if (!complete) {
    setSourceLinkStatus(['tables', 'figures'], 'unavailable');
    const summary = annotationManifestSummary(state.annotationCoverage);
    recordRuntime('Annotation coverage incomplete', `${summary.failedCount}/${summary.rangeCount} annotation range${summary.rangeCount === 1 ? '' : 's'} unavailable. Article counts were not finalized.`, 'annotation-coverage');
    return;
  }
}
async function upload(file) {
  if (file.type !== 'application/pdf') { fileName.textContent = 'Choose a PDF file.'; return; }
  if (file.size > 4 * 1024 * 1024) { fileName.textContent = 'This deployment accepts PDFs up to 4 MB.'; return; }
  showReader(); startRuntime(); state.currentReview = null; state.preservingRuntimeSnapshot = false; state.annotations = { 'front-matter': null, body: null, references: { references: [] } }; state.annotationChunks = []; state.annotationCandidates = null; state.referenceInventory = { status: 'idle', pages: [], blockCount: 0, references: [], coverage: null, issues: [], error: '' }; state.citationExtraction = { status: 'idle', ranges: [], candidates: [] }; state.documentQna = { references: null, displays: [] }; state.annotationStatus = { 'front-matter': 'idle', body: 'idle', references: 'idle' }; state.annotationCoverage = { ranges: [], completed: [], failed: [] }; state.categoryStates = initialCategoryStates(); state.sourceLinksStatus = 'idle'; state.sourceLinksByKind = { tables: 'idle', figures: 'idle' }; state.referenceLinksStatus = 'idle'; state.authorProfiles = { status: 'idle', authors: [] }; state.authorProfileToken += 1; recordRuntime('Upload started', file.name); fileName.textContent = file.name; setMode('pdf'); showProgress();
  const pdfBytes = await file.arrayBuffer();
  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
  loadPdf(pdfBytes.slice(0)).catch(() => { pdfEmpty.classList.remove('d-none'); pdfEmpty.querySelector('p').textContent = 'The PDF preview could not be rendered.'; });
  const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
  const payload = JSON.stringify({ fileName: file.name, base64 });
  let raw;
  try { raw = await request('/api/ocr/raw', payload); } catch { recordRuntime('OCR unavailable'); toc.textContent = 'Document structure is unavailable.'; return; }
  if (!raw.response.ok) { recordRuntime('OCR unavailable', raw.result.error || 'Request failed.'); toc.textContent = 'Document structure is unavailable.'; note.textContent = 'The OCR source could not be returned.'; return; }
  recordRuntime('OCR ready', `${raw.result.pages.length} pages returned.`, 'raw-ocr');
  showRawOcr(raw.result);
  let referencePromise = null;
  const startReferenceInventory = () => {
    if (!referencePromise) referencePromise = settled(runReferenceAnnotationStage(base64));
    return referencePromise;
  };
  const annotationPromise = settled(runAnnotationStages(base64, { beforeRemainingRanges: startReferenceInventory }));
  const annotationResult = await annotationPromise;
  const referenceResult = await startReferenceInventory();
  if (annotationResult.status === 'rejected') {
    state.annotationStatus = { ...state.annotationStatus, 'front-matter': 'unavailable', body: 'unavailable' };
    state.sourceLinksStatus = 'unavailable';
    setSourceLinkStatus(['tables', 'figures'], 'unavailable');
    revealAnnotationProgress();
    settlePendingCounts();
    finishDirectSourceLinks();
    recordRuntime('Annotation unavailable', annotationResult.reason?.message || 'Results could not be prepared.');
    note.textContent = 'The reader is ready. Some review details are still unavailable.';
  }
  if (referenceResult.status === 'rejected') {
    state.annotationStatus.references = 'unavailable';
    state.referenceLinksStatus = 'unavailable';
    setCategoryState('references', 'unavailable');
    setCount('references', '—', false);
    setTileProgress('references', 0, 'Unavailable');
    refreshOpenDetails(['references']);
    recordRuntime('Reference inventory unavailable', referenceResult.reason?.message || 'Individual references could not be prepared.', 'reference-inventory:unavailable');
  }
  if (annotationResult.status === 'fulfilled' && annotationManifestIsComplete(state.annotationCoverage)) {
    await runBodyCitationStage(base64);
    const linkJobs = [startSourceLinks(base64)];
    if (referenceResult.status === 'fulfilled') linkJobs.push(startReferenceLinks());
    await Promise.all(linkJobs);
  } else if (referenceResult.status === 'fulfilled') {
    state.referenceLinksStatus = 'unavailable';
    finishDirectSourceLinks();
  }
  fileName.textContent = `${raw.result.fileName} · review results ready`;
  try {
    state.currentReview = { id: crypto.randomUUID(), fileName: file.name, savedAt: new Date().toISOString(), pdfBlob, raw: raw.result, annotations: state.annotations, annotationChunks: state.annotationChunks, annotationCoverage: state.annotationCoverage, referenceInventory: state.referenceInventory, citationExtraction: state.citationExtraction, documentQna: state.documentQna, sourceLinksStatus: state.sourceLinksStatus, sourceLinksByKind: state.sourceLinksByKind, referenceLinksStatus: state.referenceLinksStatus, authorProfiles: [], runtimeSummary: runtime.entries() };
    await saveReview(state.currentReview);
    if (state.authorProfiles.status === 'ready') persistAuthorProfiles(state.authorProfiles.authors);
    recordRuntime('Review stored locally', 'Available from the home page without another OCR request.', 'storage');
  } catch {
    state.currentReview = null;
    recordRuntime('Local review storage unavailable', 'This review remains open but could not be saved in this browser.', 'storage');
  }
}
async function openStoredReview(stored, pdfData, detail) {
  const hasOriginalRuntime = Array.isArray(stored.runtimeSummary) && stored.runtimeSummary.length > 0;
  const storedReferenceInventoryEvent = (stored.runtimeSummary || []).findLast((event) => String(event?.key || '').startsWith('reference-inventory:'));
  startRuntime(hasOriginalRuntime ? stored.runtimeSummary : null);
  state.preservingRuntimeSnapshot = hasOriginalRuntime;
  if (!hasOriginalRuntime) recordRuntime('Stored review opened', 'Loading locally saved OCR and annotation results.');
  state.annotations = { 'front-matter': null, body: null, references: null };
  state.annotationChunks = Array.isArray(stored.annotationChunks) ? stored.annotationChunks : [];
  state.annotationCandidates = null;
  state.referenceInventory = stored.referenceInventory || {
    status: stored.annotations?.references?.references?.length
      ? 'ready'
      : storedReferenceInventoryEvent?.key === 'reference-inventory:unavailable'
        ? 'unavailable'
        : storedReferenceInventoryEvent?.key === 'reference-inventory:start'
          ? 'pending'
          : 'idle',
    pages: [],
    blockCount: referenceBlocksFromRawPages(stored.raw?.pages || []).length,
    references: stored.annotations?.references?.references || [],
    coverage: null,
    issues: [],
    error: storedReferenceInventoryEvent?.key === 'reference-inventory:unavailable'
      ? storedReferenceInventoryEvent.detail || 'The focused bibliography response was unavailable.'
      : ''
  };
  state.citationExtraction = stored.citationExtraction || { status: 'idle', ranges: [], candidates: [] };
  state.documentQna = stored.documentQna || { references: null, displays: [] };
  state.annotationCoverage = stored.annotationCoverage || { ranges: [], completed: [], failed: [] };
  state.annotationStatus = { 'front-matter': 'ready', body: 'ready', references: 'ready' };
  state.categoryStates = initialCategoryStates('ready');
  state.sourceLinksStatus = stored.sourceLinksStatus || 'ready';
  state.sourceLinksByKind = stored.sourceLinksByKind || { tables: state.sourceLinksStatus, figures: state.sourceLinksStatus };
  state.referenceLinksStatus = stored.referenceLinksStatus || 'unavailable';
  state.authorProfiles = { status: 'idle', authors: [] };
  state.authorProfileToken += 1;
  state.currentReview = stored?.id && stored.pdfBlob ? stored : null;
  showReader();
  setMode('pdf');
  showProgress();
  loadPdf(pdfData);
  if (!hasOriginalRuntime) recordRuntime('Stored OCR ready', `${stored.raw.pages.length} pages loaded without an API request.`);
  showRawOcr(stored.raw);
  const annotations = storedAnnotationsForDisplay(stored);
  showFrontMatterCounts(annotations['front-matter'], stored.authorProfiles);
  showBodyCounts(annotations.body);
  showReferenceCounts(annotations.references);
  state.categoryStates = initialCategoryStates('ready');
  document.querySelectorAll('[data-count]').forEach((tile) => { applyCategoryTileState(tile.dataset.count); setTileProgress(tile.dataset.count, 100, 'Ready'); });
  note.textContent = 'Stored OCR and source-linked results are loaded locally.';
  fileName.textContent = `${stored.fileName} · ${detail}`;
  if (!hasOriginalRuntime) recordRuntime('Stored annotation ready', 'Front matter, body, and references loaded locally.');
}

function storedAnnotationsForDisplay(stored = {}) {
  const annotations = stored.annotations || {};
  const frontMatter = annotations['front-matter'] || {};
  const hasAbstract = Array.isArray(frontMatter.abstract?.prose_blocks);
  if (hasAbstract || !Array.isArray(stored.annotationChunks) || !stored.annotationChunks.length) return annotations;
  const projectedAbstract = projectAnnotationChunks(stored.annotationChunks).annotation.front_matter?.abstract;
  if (!Array.isArray(projectedAbstract?.prose_blocks)) return annotations;
  return {
    ...annotations,
    'front-matter': {
      ...frontMatter,
      abstract: projectedAbstract
    }
  };
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
el('#pdfEmptyUploadButton')?.addEventListener('click', () => input.click());
el('#storedReviewsPdfInput')?.addEventListener('change', async (event) => { const file = event.currentTarget.files?.[0]; if (!file) return; try { window.bootstrap?.Modal.getInstance(el('#storedReviewsModal'))?.hide(); await upload(file); } catch { toc.textContent = 'The document could not be processed.'; } finally { event.currentTarget.value = ''; } });
pdfMode.addEventListener('click', () => setMode('pdf')); htmlMode.addEventListener('click', () => setMode('html')); htmlMode.addEventListener('animationend', () => htmlMode.classList.remove('is-html-ready'));
el('#manuscriptSearchToggleButton').addEventListener('click', () => { const control = el('#manuscriptSearchControl'); const open = control.classList.toggle('is-open'); control.setAttribute('aria-hidden', String(!open)); el('#manuscriptSearchToggleButton').setAttribute('aria-expanded', String(open)); if (open) el('#pdfSearchInput').focus(); });
el('#pdfSearchInput').addEventListener('input', (event) => updateManuscriptSearch(event.target.value));
el('#pdfSearchInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); stepManuscriptSearch(event.shiftKey ? -1 : 1); } if (event.key === 'Escape') { event.currentTarget.value = ''; updateManuscriptSearch(''); } });
el('#manuscriptSearchPrevious').addEventListener('click', () => stepManuscriptSearch(-1));
el('#manuscriptSearchNext').addEventListener('click', () => stepManuscriptSearch(1));
el('#tocToggleButton').addEventListener('click', () => { const collapsed = reader.classList.toggle('toc-collapsed'); el('#tocToggleButton').setAttribute('aria-expanded', String(!collapsed)); });
el('#countsToggleButton').addEventListener('click', () => { const collapsed = reader.classList.toggle('counts-collapsed'); el('#countsToggleButton').setAttribute('aria-expanded', String(!collapsed)); el('#countsToggleButton i').className = collapsed ? 'bi bi-layout-sidebar-reverse' : 'bi bi-x-lg'; });
el('#tocSplitter').addEventListener('pointerdown', (event) => beginResize('toc', event)); el('#countsSplitter').addEventListener('pointerdown', (event) => beginResize('counts', event)); window.addEventListener('pointermove', moveResize); window.addEventListener('pointerup', endResize);
document.querySelectorAll('.count-tile').forEach((tile) => tile.addEventListener('click', () => openDetails(tile.dataset.count))); el('#detailsPanelClose').addEventListener('click', closeDetails);
document.querySelectorAll('[data-open-guideline]').forEach((button) => button.addEventListener('click', () => { el('#guidelineDetailName').textContent = button.dataset.openGuideline; el('#guidelineDetailSlider').classList.add('is-open'); })); el('#closeGuidelineDetailSlider').addEventListener('click', () => el('#guidelineDetailSlider').classList.remove('is-open'));
el('#annotationContractModal').addEventListener('show.bs.modal', () => {
  renderDeveloperDiagnosticsContext();
  renderAnnotationSourceScope();
  renderAnnotationReturnedData();
  renderFocusedCitationContract();
  renderReferenceInventoryDiagnostics();
  renderCitationGroundingAudit();
  renderDocumentQnaDiagnostics();
  renderRuntimeSummary();
});
el('#homeDemoModal').addEventListener('hidden.bs.modal', () => { const video = el('#homeDemoVideo'); video.pause(); video.currentTime = 0; });
applyPaneWidths();
new ResizeObserver(schedulePdfRender).observe(el('#centerPane'));
const storedReview = new URLSearchParams(window.location.search).get('review');
await initHome({ onUpload: upload, onOpenReview: openHomeReview, onOpenStoredReviews: openStoredReviewsLibrary });
if (storedReview) openHomeReview(`example:${storedReview}`);
enableLocalLiveReload();
