import { listReviews, removeReview } from '/review-store.js';
import { documentAnnotationFormat, documentAnnotationPrompt, documentAnnotationPromptInstructions } from '/core/document-annotation.js';
import { renderSchemaOverview } from '/app/schema-browser.js';

const examples = [
  { id: 'medrxiv', source: 'medRxiv', year: '2021', title: 'Combined Exercise Training vs Health Education for Older Adults with Hypertension: The HAEL Randomized Clinical Trial', itemCount: 201, rating: 4 },
  { id: 'chemrxiv', source: 'chemRxiv', year: '2025', title: 'A soy protein substitute for animal meat proteins can provide global phosphorus reduction and recirculation opportunities', itemCount: 74, rating: 3.5 },
  { id: 'eartharxiv', source: 'EarthArXiv', year: '2021', title: 'Modeling Lithospheric Radioactivity Influence on Atmospheric Electric Properties Relative to Earthquakes', itemCount: 137, rating: 2.5 },
  { id: 'researchsquare', source: 'Research Square', year: '2023', title: 'User Experience Design Methodologies for Building User Interfaces for Teleround System for Intensive Care Units', itemCount: 155, rating: 2.5 },
  { id: 'psyarxiv', source: 'psyArXiv', year: '', title: 'How age, driving experience, and gender interact in predicting dangerous driving behavior', itemCount: 130, rating: 3.5 }
];

const element = (selector) => document.querySelector(selector);
let homeRevealObserver = null;
let homeFeatureObserver = null;
let storedReviewsShortcutHandler = null;
let pendingReviewDeletion = null;

function isLocalDeveloperEnvironment() {
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function configureAnnotationContractInspector() {
  const button = element('#annotationContractButton');
  const format = element('#annotationFormatCode');
  const overview = element('#annotationFormatOverview');
  const prompt = element('#annotationPromptInstructions');
  const promptRaw = element('#annotationPromptText');
  if (!button || !format || !overview || !prompt || !promptRaw || !isLocalDeveloperEnvironment()) return;
  renderSchemaOverview({ container: overview, format: documentAnnotationFormat, idPrefix: 'annotationSchema' });
  format.textContent = JSON.stringify(documentAnnotationFormat, null, 2);
  documentAnnotationPromptInstructions.forEach((instruction) => {
    const item = document.createElement('li');
    item.className = 'mb-3 ps-1';
    item.textContent = instruction;
    prompt.append(item);
  });
  promptRaw.textContent = documentAnnotationPrompt;
  button.classList.remove('d-none');
}

function appendStars(container, value = 0) {
  const rounded = Math.round(Math.max(0, Math.min(5, Number(value || 0))) * 2) / 2;
  Array.from({ length: 5 }, (_, index) => {
    const icon = document.createElement('i');
    const star = index + 1;
    icon.className = rounded >= star ? 'bi bi-star-fill' : rounded === star - .5 ? 'bi bi-star-half' : 'bi bi-star';
    icon.setAttribute('aria-hidden', 'true');
    container.append(icon);
  });
}

function startLeadTypewriter() {
  const lead = element('[data-home-lead]');
  const target = lead?.querySelector('.home-lead-typewriter');
  const text = lead?.dataset.homeLead;
  if (!lead || !target || !text) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    target.textContent = text;
    lead.classList.add('is-complete');
    return;
  }
  let index = 0;
  const tick = () => {
    target.textContent = text.slice(0, index);
    index += 1;
    if (index <= text.length) window.setTimeout(tick, index < 42 ? 9 : 13);
    else lead.classList.add('is-complete');
  };
  tick();
}

function initHomeScrollReveals() {
  const items = [...document.querySelectorAll('.home-scroll-reveal')];
  const features = [...document.querySelectorAll('.home-feature-story')];
  if (!items.length) return;
  items.forEach((item, index) => {
    if (!item.style.getPropertyValue('--home-reveal-index')) item.style.setProperty('--home-reveal-index', String(index % 4));
  });
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-visible'));
    features.forEach((item) => item.classList.add('is-in-focus'));
    return;
  }
  homeRevealObserver?.disconnect();
  homeFeatureObserver?.disconnect();
  homeRevealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      homeRevealObserver.unobserve(entry.target);
    });
  }, { root: element('#homeView'), rootMargin: '0px 0px -12% 0px', threshold: 0.18 });
  homeFeatureObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.target.classList.toggle('is-in-focus', entry.isIntersecting));
  }, { root: element('#homeView'), rootMargin: '-18% 0px -22% 0px', threshold: 0.38 });
  items.forEach((item) => homeRevealObserver.observe(item));
  features.forEach((item) => homeFeatureObserver.observe(item));
}

function initHomeAnchorLinks() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const target = element(link.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', link.getAttribute('href'));
    });
  });
}

function initUspComparison() {
  const rows = [...document.querySelectorAll('#uspComparisonBody .usp-row')];
  const detail = element('#uspDetailPanel .usp-detail-inner');
  if (!rows.length || !detail) return;
  const activate = (row) => {
    rows.forEach((item) => item.classList.toggle('is-active', item === row));
    const text = row.dataset.uspText || '';
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      detail.textContent = text;
      return;
    }
    detail.classList.add('is-fading');
    window.setTimeout(() => {
      detail.textContent = text;
      detail.classList.remove('is-fading');
    }, 130);
  };
  rows.forEach((row) => {
    row.addEventListener('mouseenter', () => activate(row));
    row.addEventListener('focusin', () => activate(row));
    row.addEventListener('click', () => activate(row));
  });
}

function exampleCard(example, onOpenReview, index = 0) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'card text-start shadow-sm border rounded-3 flex-shrink-0 example-card home-scroll-reveal';
  button.style.setProperty('--home-reveal-index', String(index));
  button.dataset.exampleReview = example.id;
  button.dataset.exampleId = example.id;
  const body = document.createElement('span');
  body.className = 'card-body d-block';
  const metadata = document.createElement('span');
  metadata.className = 'example-meta text-secondary small d-block';
  metadata.textContent = [example.source, example.year, 'preprint'].filter(Boolean).join(' · ');
  const title = document.createElement('h3');
  title.className = 'h6 mt-3 mb-0 example-title';
  title.textContent = example.title;
  body.append(metadata, title);
  const footer = document.createElement('span');
  footer.className = 'card-footer bg-transparent border-0 pt-0 d-flex align-items-center justify-content-between small text-secondary';
  const stars = document.createElement('span');
  stars.className = 'example-stars text-body-tertiary';
  stars.setAttribute('aria-label', `${example.rating} out of 5`);
  appendStars(stars, example.rating);
  const items = document.createElement('span');
  items.className = 'example-items';
  items.textContent = `${example.itemCount} items`;
  const action = document.createElement('span');
  action.className = 'example-card-cta d-inline-flex align-items-center gap-1';
  action.innerHTML = '<span>Open review</span><i class="bi bi-arrow-right" aria-hidden="true"></i>';
  const meta = document.createElement('span');
  meta.className = 'd-inline-flex flex-column align-items-end gap-1';
  meta.append(items, action);
  footer.append(stars, meta);
  button.append(body, footer);
  button.addEventListener('click', () => onOpenReview(`example:${example.id}`));
  return button;
}

function formatDate(value) {
  if (!value) return 'Just now';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function reviewRow(review, onOpen, onDeleteRequest) {
  const row = document.createElement('tr');
  const authorCount = review.annotations?.['front-matter']?.authors?.length;
  const referenceCount = review.annotations?.references?.references?.length;
  const counts = [Number.isFinite(authorCount) ? `${authorCount} authors` : null, Number.isFinite(referenceCount) ? `${referenceCount} references` : null].filter(Boolean).join(' · ') || 'Partial review';
  const manuscript = document.createElement('td'); const name = document.createElement('button'); name.type = 'button'; name.className = 'btn btn-link p-0 text-start text-decoration-none home-review-name'; name.textContent = review.fileName; manuscript.append(name);
  const pages = document.createElement('td'); pages.className = 'text-secondary'; pages.textContent = String(review.raw?.pages?.length || '—');
  const countCell = document.createElement('td'); countCell.className = 'text-secondary'; countCell.textContent = counts;
  const stored = document.createElement('td'); stored.className = 'text-secondary text-nowrap'; stored.textContent = formatDate(review.savedAt);
  const actions = document.createElement('td'); actions.className = 'text-end'; const group = document.createElement('div'); group.className = 'btn-group btn-group-sm'; const open = document.createElement('button'); open.type = 'button'; open.className = 'btn btn-light border'; open.textContent = 'Open'; const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-light border'; remove.setAttribute('aria-label', 'Delete stored review'); remove.innerHTML = '<i class="bi bi-trash3" aria-hidden="true"></i>'; group.append(open, remove); actions.append(group);
  name.addEventListener('click', () => onOpen(review.id)); open.addEventListener('click', () => onOpen(review.id)); remove.addEventListener('click', () => onDeleteRequest(review));
  row.append(manuscript, pages, countCell, stored, actions);
  return row;
}

function requestStoredReviewDeletion(review, onOpenReview) {
  const libraryElement = element('#storedReviewsModal');
  const confirmationElement = element('#deleteStoredReviewModal');
  if (!libraryElement || !confirmationElement) return;
  pendingReviewDeletion = { review, onOpenReview };
  element('#deleteStoredReviewName').textContent = review.fileName || 'Untitled manuscript';
  element('#deleteStoredReviewError')?.classList.add('d-none');
  const showConfirmation = () => window.bootstrap?.Modal.getOrCreateInstance(confirmationElement)?.show();
  if (libraryElement.classList.contains('show')) {
    libraryElement.addEventListener('hidden.bs.modal', showConfirmation, { once: true });
    window.bootstrap?.Modal.getOrCreateInstance(libraryElement)?.hide();
  } else {
    showConfirmation();
  }
}

async function confirmStoredReviewDeletion() {
  const pending = pendingReviewDeletion;
  const button = element('#confirmDeleteStoredReviewButton');
  const error = element('#deleteStoredReviewError');
  if (!pending || !button) return;
  button.disabled = true;
  error?.classList.add('d-none');
  try {
    await removeReview(pending.review.id);
    await refreshHome({ onOpenReview: pending.onOpenReview });
    window.bootstrap?.Modal.getOrCreateInstance(element('#deleteStoredReviewModal'))?.hide();
  } catch {
    error?.classList.remove('d-none');
  } finally {
    button.disabled = false;
  }
}

function updateStoredReviewsShortcut(count = 0) {
  const button = element('#homeStoredReviewsButton');
  if (!button) return;
  button.classList.toggle('d-none', count === 0);
  const countNode = button.querySelector('[data-home-stored-review-count]');
  if (countNode) countNode.textContent = String(count);
}

export async function refreshHome({ onOpenReview }) {
  const rows = await listReviews();
  const body = element('#reviewLibraryBody');
  const empty = element('#storedReviewsEmpty');
  const tableWrap = element('#storedReviewsTableWrap');
  body?.replaceChildren();
  empty?.classList.toggle('d-none', rows.length > 0);
  tableWrap?.classList.toggle('d-none', rows.length === 0);
  updateStoredReviewsShortcut(rows.length);
  rows.forEach((review) => body?.append(reviewRow(review, (id) => {
    window.bootstrap?.Modal.getInstance(element('#storedReviewsModal'))?.hide();
    onOpenReview(id);
  }, (item) => requestStoredReviewDeletion(item, onOpenReview))));
}

export async function initHome({ onUpload, onOpenReview, onOpenStoredReviews }) {
  const input = element('#homePdfInput');
  const list = element('#exampleManuscriptList');
  const storedReviewsShortcut = element('#homeStoredReviewsButton');
  const deleteConfirmation = element('#deleteStoredReviewModal');
  storedReviewsShortcutHandler = onOpenStoredReviews;
  configureAnnotationContractInspector();
  list.replaceChildren(...examples.map((example, index) => exampleCard(example, onOpenReview, index)));
  initHomeScrollReveals();
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) await onUpload(file);
  });
  storedReviewsShortcut?.addEventListener('click', () => storedReviewsShortcutHandler?.());
  startLeadTypewriter();
  initHomeScrollReveals();
  initHomeAnchorLinks();
  initUspComparison();
  element('#storedReviewsModal')?.addEventListener('show.bs.modal', () => { refreshHome({ onOpenReview }).catch(() => {}); });
  element('#confirmDeleteStoredReviewButton')?.addEventListener('click', () => { confirmStoredReviewDeletion().catch(() => {}); });
  deleteConfirmation?.addEventListener('hidden.bs.modal', () => {
    if (!pendingReviewDeletion) return;
    pendingReviewDeletion = null;
    window.bootstrap?.Modal.getOrCreateInstance(element('#storedReviewsModal'))?.show();
  });
  await refreshHome({ onOpenReview });
}
