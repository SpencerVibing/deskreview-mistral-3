import { listReviews, removeReview } from '/review-store.js';

const examples = [
  { id: 'medrxiv', source: 'medRxiv', year: '2021', title: 'Combined Exercise Training vs Health Education for Older Adults with Hypertension: The HAEL Randomized Clinical Trial', itemCount: 201, rating: 4 },
  { id: 'chemrxiv', source: 'chemRxiv', year: '2025', title: 'A soy protein substitute for animal meat proteins can provide global phosphorus reduction and recirculation opportunities', itemCount: 74, rating: 3.5 },
  { id: 'eartharxiv', source: 'EarthArXiv', year: '2021', title: 'Modeling Lithospheric Radioactivity Influence on Atmospheric Electric Properties Relative to Earthquakes', itemCount: 137, rating: 2.5 },
  { id: 'researchsquare', source: 'Research Square', year: '2023', title: 'User Experience Design Methodologies for Building User Interfaces for Teleround System for Intensive Care Units', itemCount: 155, rating: 2.5 },
  { id: 'psyarxiv', source: 'psyArXiv', year: '', title: 'How age, driving experience, and gender interact in predicting dangerous driving behavior', itemCount: 130, rating: 3.5 }
];

const element = (selector) => document.querySelector(selector);

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

function exampleCard(example, onOpenReview) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'card text-start shadow-sm border rounded-3 flex-shrink-0 example-card';
  button.dataset.exampleReview = example.id;
  button.dataset.exampleId = example.id;
  const body = document.createElement('span');
  body.className = 'card-body d-block';
  const metadata = document.createElement('span');
  metadata.className = 'text-secondary small d-block';
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
  footer.append(stars, items);
  button.append(body, footer);
  button.addEventListener('click', () => onOpenReview(`example:${example.id}`));
  return button;
}

function formatDate(value) {
  if (!value) return 'Just now';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function reviewRow(review, onOpen, onDelete) {
  const row = document.createElement('tr');
  const authorCount = review.annotations?.['front-matter']?.authors?.length;
  const referenceCount = review.annotations?.references?.references?.length;
  const counts = [Number.isFinite(authorCount) ? `${authorCount} authors` : null, Number.isFinite(referenceCount) ? `${referenceCount} references` : null].filter(Boolean).join(' · ') || 'Partial review';
  const manuscript = document.createElement('td'); const name = document.createElement('button'); name.type = 'button'; name.className = 'btn btn-link p-0 text-start text-decoration-none home-review-name'; name.textContent = review.fileName; manuscript.append(name);
  const pages = document.createElement('td'); pages.className = 'text-secondary'; pages.textContent = String(review.raw?.pages?.length || '—');
  const countCell = document.createElement('td'); countCell.className = 'text-secondary'; countCell.textContent = counts;
  const stored = document.createElement('td'); stored.className = 'text-secondary text-nowrap'; stored.textContent = formatDate(review.savedAt);
  const actions = document.createElement('td'); actions.className = 'text-end'; const group = document.createElement('div'); group.className = 'btn-group btn-group-sm'; const open = document.createElement('button'); open.type = 'button'; open.className = 'btn btn-light border'; open.textContent = 'Open'; const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-light border'; remove.setAttribute('aria-label', 'Delete stored review'); remove.innerHTML = '<i class="bi bi-trash3" aria-hidden="true"></i>'; group.append(open, remove); actions.append(group);
  name.addEventListener('click', () => onOpen(review.id)); open.addEventListener('click', () => onOpen(review.id)); remove.addEventListener('click', () => onDelete(review.id));
  row.append(manuscript, pages, countCell, stored, actions);
  return row;
}

export async function refreshHome({ onOpenReview }) {
  const rows = await listReviews();
  const exampleSection = element('#examplesSection');
  const storedSection = element('#storedReviewsSection');
  const body = element('#reviewLibraryBody');
  exampleSection.classList.toggle('d-none', rows.length > 0);
  storedSection.classList.toggle('d-none', rows.length === 0);
  body.replaceChildren();
  rows.forEach((review) => body.append(reviewRow(review, onOpenReview, async (id) => { await removeReview(id); await refreshHome({ onOpenReview }); })));
}

export async function initHome({ onUpload, onOpenReview }) {
  const input = element('#homePdfInput');
  const list = element('#exampleManuscriptList');
  list.replaceChildren(...examples.map((example) => exampleCard(example, onOpenReview)));
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) await onUpload(file);
  });
  startLeadTypewriter();
  await refreshHome({ onOpenReview });
}
