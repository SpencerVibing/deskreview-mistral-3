import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.DESKREVIEW_M3_BASE_URL || 'http://127.0.0.1:8893';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const raw = {
  fileName: 'fixture.pdf', elapsedMs: 3100,
  pages: [{ markdown: '# **Paper title**\n\nAda Author\n\nAbstract\n\n## Methods\n\nTable 1 source caption', tables: [{ content: '<table><tr><td>Example cell</td></tr></table>' }], blocks: [{ type: 'title', content: '# Paper title' }, { type: 'title', content: '# Discussion' }, { type: 'heading', content: '## Methods' }, { type: 'image', content: 'Figure 1' }] }]
};
const annotation = {
  fileName: 'fixture.pdf', elapsedMs: 95000, pages: raw.pages,
  annotation: {
    front_matter: {
      title: { text: 'Paper title', source: { page_number: 1, exact_quote: 'Paper title' } },
      authors: [{ text: 'Ada Author', source: { page_number: 1, exact_quote: 'Ada Author' } }], affiliations: [], keywords: [{ text: 'Unconfirmed keyword', source: { page_number: 1, exact_quote: 'Not in OCR text' } }],
      abstract: { text: 'Abstract', word_count: 1, source: { page_number: 1, exact_quote: 'Abstract' } }
    },
    body: { sections: [{ heading: 'Methods', level: 1, text: 'Methods', word_count: 1, source: { page_number: 1, exact_quote: 'Methods' } }], display_items: [{ kind: 'table', label: 'Table 1', source: { page_number: 1, exact_quote: 'Table 1' } }] },
    references: { references: [] }
  }
};
function sourceExistsOnDeclaredPage(review, item) {
  const pageNumber = Number(item?.source?.page_number || 0);
  const quote = String(item?.source?.exact_quote || '').trim();
  const page = review.raw?.pages?.[pageNumber - 1];
  if (!page || !quote) return false;
  const values = [page.markdown || page.content || '', ...(page.tables || []).map((table) => table.content || ''), ...(page.blocks || []).map((block) => block.content || '')];
  return values.some((value) => String(value).includes(quote));
}
await page.route('**/api/ocr/**', async (route) => {
  assert.match(route.request().url(), /\/api\/ocr\/analyse$/);
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(annotation) });
});
await page.goto(baseUrl);
assert.equal(await page.locator('#homeView').evaluate((node) => !node.classList.contains('d-none')), true);
assert.equal(await page.locator('#exampleManuscriptList .example-card').count(), 5);
assert.equal(await page.locator('#exampleManuscriptList .example-card').filter({ hasText: /chemRxiv\s+·\s+2025\s+·\s+preprint/ }).count(), 1);
assert.equal(await page.locator('#exampleManuscriptList [data-example-id="oraktx"]').count(), 0);
assert.equal(await page.locator('.integration-logo-item').count(), 6);
assert.equal(await page.locator('[data-home-lead]').getAttribute('aria-label'), 'DeskReview identifies the right reporting guides for your research manuscript, audits it for compliance, and delivers detailed, verifiable results in minutes.');
await page.locator('[data-home-lead].is-complete').waitFor({ state: 'attached', timeout: 5000 });
for (const href of ['/about.html', '/team.html', '/download.html', '/privacy.html', '/terms.html', '/assets/copyright/copyright.txt']) {
  assert.equal(await page.locator(`.home-footer a[href="${href}"]`).count(), 1);
}
await page.locator('.home-preview').click();
await page.locator('#homeDemoModal.show').waitFor({ state: 'visible' });
assert.equal(await page.locator('#homeDemoVideo source').getAttribute('src'), '/assets/demo.mp4');
await page.locator('#homeDemoModal .btn-close').click();
await page.locator('[data-example-id="chemrxiv"]').click();
await page.getByText('chemRxiv.pdf · stored example', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await page.locator('[data-count="references"] strong').textContent(), '63');
await page.goto(baseUrl);
await page.locator('#pdfInput').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
await page.locator('.toc-button').first().waitFor({ state: 'visible' });
assert.equal(await page.locator('.toc-button').count(), 3);
assert.equal(await page.locator('.toc-button').first().textContent(), 'Title');
assert.equal(await page.locator('.toc-button').filter({ hasText: /^Title$/ }).count(), 1);
assert.equal(await page.locator('[data-count="tables"] strong').textContent(), '1');
assert.equal(await page.locator('[data-count="authors"]').evaluate((el) => el.classList.contains('is-loading')), false);
assert.equal(await page.locator('#htmlMode.is-html-ready').count(), 1);
assert.equal(await page.locator('.ocr-html strong').getByText('Paper title', { exact: true }).count(), 1);
assert.equal(await page.locator('.ocr-html table').count(), 1);
await page.locator('[data-count="authors"]').click();
assert.equal(await page.locator('#detailsPanelBody').getByText('Ada Author', { exact: true }).count(), 1);
await page.locator('#detailsPanelClose').click();
await page.locator('[data-count="tables"]').click();
assert.equal(await page.locator('#detailsPanel').evaluate((node) => node.classList.contains('is-open')), true);
await page.locator('#detailsPanelClose').click();
assert.equal(await page.locator('#detailsPanel').evaluate((node) => node.classList.contains('is-open')), false);
await page.locator('#tocToggleButton').click();
assert.equal(await page.locator('#reader').evaluate((node) => node.classList.contains('toc-collapsed')), true);
await page.locator('#tocToggleButton').click();
const splitterBox = await page.locator('#tocSplitter').boundingBox();
const readerBox = await page.locator('#reader').boundingBox();
assert.ok(splitterBox && readerBox);
await page.locator('#tocSplitter').dispatchEvent('pointerdown', { clientX: splitterBox.x + 2, clientY: splitterBox.y + 120 });
await page.evaluate((coordinates) => window.dispatchEvent(new PointerEvent('pointermove', { clientX: coordinates.readerLeft + 400, clientY: coordinates.y })), { readerLeft: readerBox.x, y: splitterBox.y + 120 });
await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup')));
assert.ok(Number.parseFloat(await page.locator('#reader').evaluate((node) => node.style.getPropertyValue('--toc-width'))) > 288);
await page.locator('button[aria-label="Checks options"]').click();
await page.locator('.dropdown-menu button[data-bs-target="#customizeChecksModal"]').click();
await page.locator('#customizeChecksModal.show').waitFor({ state: 'visible' });
await page.locator('#customizeChecksModal .btn-close').click();
await page.locator('#guidelineSelectorModal').evaluate((node) => node.classList.add('show'));
await page.locator('#guidelineSelectorModal').evaluate((node) => { node.style.display = 'block'; });
await page.locator('[data-open-guideline="CONSORT"]').click();
assert.equal(await page.locator('#guidelineDetailSlider').evaluate((node) => node.classList.contains('is-open')), true);
await page.locator('#closeGuidelineDetailSlider').click();
await page.locator('#guidelineSelectorModal').evaluate((node) => { node.classList.remove('show'); node.style.display = ''; });
await page.getByRole('button', { name: 'Chat' }).click();
assert.equal(await page.locator('#chatPane').evaluate((node) => node.classList.contains('show')), true);
assert.equal(await page.locator('#chatInput').count(), 1);
await page.getByRole('button', { name: 'Comments' }).click();
assert.equal(await page.locator('#commentsPane').evaluate((node) => node.classList.contains('show')), true);
assert.equal(await page.locator('#commentsAccordion .accordion-button').count(), 3);
await page.getByRole('button', { name: 'Checks' }).click();
assert.equal(await page.locator('[data-count="authors"] strong').textContent(), '1');
assert.equal(await page.locator('.toc-button').first().textContent(), 'Title');
await page.locator('[data-count="authors"]').click();
assert.equal(await page.locator('#detailsPanelBody').getByText('Ada Author', { exact: true }).count(), 1);
assert.equal(await page.locator('#detailsPanelBody').getByText('Open source in HTML', { exact: true }).count(), 1);
await page.locator('#detailsPanelBody .detail-jump').click();
assert.equal(await page.locator('#htmlPane').evaluate((node) => !node.classList.contains('d-none')), true);
assert.equal(await page.locator('.source-target-highlight').getByText('Ada Author', { exact: true }).count(), 1);
await page.locator('#detailsPanelClose').click();
await page.locator('[data-count="keywords"]').click();
assert.equal(await page.locator('#detailsPanelBody').getByText('This item is available, but its exact source link could not be confirmed.', { exact: true }).count(), 1);
await page.waitForTimeout(250);
const libraryPage = await page.context().newPage();
await libraryPage.route('**/api/ocr/**', (route) => route.abort());
await libraryPage.goto(baseUrl);
await libraryPage.getByText('fixture.pdf', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await libraryPage.locator('#storedReviewsSection').evaluate((node) => !node.classList.contains('d-none')), true);
assert.equal(await libraryPage.locator('#examplesSection').evaluate((node) => node.classList.contains('d-none')), true);
await libraryPage.getByText('fixture.pdf', { exact: true }).click();
await libraryPage.getByText('fixture.pdf · stored review', { exact: true }).waitFor({ state: 'visible' });
await libraryPage.close();
const storedPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await storedPage.route('**/api/ocr/**', (route) => route.abort());
await storedPage.goto(`${baseUrl}?review=medrxiv`);
await storedPage.getByText('medrxiv.pdf · stored example', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await storedPage.locator('[data-count="authors"] strong').textContent(), '23');
assert.equal(await storedPage.locator('.toc-button').filter({ hasText: /^Title$/ }).count(), 1);
assert.equal(await storedPage.locator('.ocr-reference-list li').count(), 22);
await storedPage.locator('#pdfCanvasHost canvas').first().waitFor({ state: 'visible', timeout: 30000 });
assert.equal(await storedPage.locator('#pdfFrame').count(), 0);
await storedPage.locator('.pdf-page[data-page="5"]').waitFor({ state: 'attached', timeout: 30000 });
await storedPage.locator('.toc-button').filter({ hasText: /^Introduction$/ }).click();
await storedPage.waitForTimeout(250);
assert.ok(await storedPage.locator('.pdf-scroll').evaluate((node) => node.scrollTop > 0));
assert.equal(await storedPage.locator('#pdfPane').evaluate((node) => !node.classList.contains('d-none')), true);
await storedPage.locator('#htmlMode').click();
await storedPage.locator('.toc-button').filter({ hasText: /^Introduction$/ }).click();
await storedPage.waitForTimeout(250);
assert.ok(await storedPage.locator('.html-scroll').evaluate((node) => node.scrollTop > 0));
assert.equal(await storedPage.locator('.source-target-highlight').getByText('Introduction', { exact: true }).count(), 1);
await storedPage.locator('#manuscriptSearchToggleButton').click();
await storedPage.locator('#pdfSearchInput').fill('the');
await storedPage.locator('#manuscriptSearchStatus').waitFor({ state: 'visible' });
assert.match(await storedPage.locator('#manuscriptSearchStatus').textContent(), /^1 \/ \d+$/);
assert.equal(await storedPage.locator('.manuscript-search-highlight').count(), 1);
await storedPage.locator('#manuscriptSearchNext').click();
assert.match(await storedPage.locator('#manuscriptSearchStatus').textContent(), /^2 \/ \d+$/);
await storedPage.locator('#pdfMode').click();
await storedPage.locator('.pdf-page-search-target').waitFor({ state: 'visible' });
await storedPage.locator('#runtimeSummaryButton').click();
await storedPage.locator('#runtimeSummaryModal.show').waitFor({ state: 'visible' });
assert.equal(await storedPage.locator('#runtimeSummarySections').getByText('Stored OCR ready', { exact: true }).count(), 1);
assert.equal(await storedPage.locator('#runtimeSummarySections').getByText('Table of contents ready', { exact: true }).count(), 1);
assert.equal(await storedPage.locator('#runtimeSummarySections').getByText('Authors count ready', { exact: true }).count(), 1);
assert.equal(await storedPage.locator('#runtimeSummarySections').getByText('References source links ready', { exact: true }).count(), 1);
assert.ok(await storedPage.locator('#runtimeSummarySections time').first().textContent().then((value) => value.startsWith('+')));
await storedPage.locator('#runtimeSummaryModal .btn-close').click();
await storedPage.locator('[data-count="references"]').click();
await storedPage.locator('#detailsPanelBody .detail-jump').first().waitFor({ state: 'visible' });
assert.equal(await storedPage.locator('#detailsPanelBody').getByText('Open source in HTML', { exact: true }).count(), 22);
await storedPage.locator('#detailsPanelBody .detail-jump').first().click();
assert.equal(await storedPage.locator('#htmlPane').evaluate((node) => !node.classList.contains('d-none')), true);
await storedPage.locator('.ocr-reference-target, .source-target-highlight').waitFor({ state: 'visible' });
await storedPage.locator('#detailsPanelClose').click();
await storedPage.locator('#pdfMode').click();
await storedPage.locator('#pdfCanvasHost canvas').first().waitFor({ state: 'visible', timeout: 30000 });
const canvasBefore = await storedPage.locator('#pdfCanvasHost canvas').first().boundingBox();
const countsSplitter = await storedPage.locator('#countsSplitter').boundingBox();
assert.ok(canvasBefore && countsSplitter);
await storedPage.locator('#countsSplitter').dispatchEvent('pointerdown', { clientX: countsSplitter.x + 2, clientY: countsSplitter.y + 120 });
await storedPage.evaluate((coordinates) => window.dispatchEvent(new PointerEvent('pointermove', coordinates)), { clientX: countsSplitter.x + 110, clientY: countsSplitter.y + 120 });
await storedPage.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup')));
await storedPage.waitForTimeout(250);
const canvasAfter = await storedPage.locator('#pdfCanvasHost canvas').first().boundingBox();
assert.ok(canvasAfter && canvasBefore);
await storedPage.close();
const oraktxPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await oraktxPage.route('**/api/ocr/**', (route) => route.abort());
await oraktxPage.goto(`${baseUrl}?review=oraktx`);
await oraktxPage.getByText('ORAKTx.pdf · stored example', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await oraktxPage.locator('[data-count="keywords"] strong').textContent(), '6');
assert.equal(await oraktxPage.locator('[data-count="references"] strong').textContent(), '31');
assert.equal(await oraktxPage.locator('.ocr-reference-list li').count(), 31);
await oraktxPage.close();
const chemrxivPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await chemrxivPage.route('**/api/ocr/**', (route) => route.abort());
await chemrxivPage.goto(`${baseUrl}?review=chemrxiv`);
await chemrxivPage.getByText('chemRxiv.pdf · stored example', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await chemrxivPage.locator('[data-count="authors"] strong').textContent(), '5');
assert.equal(await chemrxivPage.locator('[data-count="references"] strong').textContent(), '63');
await chemrxivPage.locator('[data-count="references"]').click();
await chemrxivPage.locator('#detailsPanelBody .detail-jump').first().click();
await chemrxivPage.locator('.ocr-reference-target').waitFor({ state: 'visible' });
assert.equal(await chemrxivPage.locator('.ocr-reference-target').count(), 1, 'A reference jump targets one bibliography item, not its containing OCR page');
assert.match(await chemrxivPage.locator('.ocr-reference-target').textContent(), /Cordell/);
assert.ok(await chemrxivPage.locator('.ocr-figure img').count() > 0, 'ChemRxiv OCR image assets are rendered');
assert.equal(await chemrxivPage.locator('.ocr-figure img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true, 'ChemRxiv figure image data URLs decode successfully');
await chemrxivPage.close();
for (const [id, file, authors, references] of [['chemrxiv', 'chemRxiv.pdf', '5', '63'], ['eartharxiv', 'EarthArXiv.pdf', '3', '47'], ['researchsquare', 'ResearchSquare.pdf', '8', '29'], ['psyarxiv', 'psyArXiv.pdf', '2', '64']]) {
  const storedPreprintPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await storedPreprintPage.route('**/api/ocr/**', (route) => route.abort());
  await storedPreprintPage.goto(`${baseUrl}?review=${id}`);
  await storedPreprintPage.getByText(`${file} · stored example`, { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await storedPreprintPage.locator('[data-count="authors"] strong').textContent(), authors);
  assert.equal(await storedPreprintPage.locator('[data-count="references"] strong').textContent(), references);
  if (id === 'chemrxiv') {
    assert.equal(await storedPreprintPage.locator('.ocr-markdown-paragraph').evaluateAll((nodes) => nodes.some((node) => node.innerHTML.includes('<br>'))), false, 'ChemRxiv OCR wraps are rendered as readable paragraphs');
    assert.equal(await storedPreprintPage.locator('.ocr-html').textContent().then((text) => /\n\s*2 Animal meat protein consumption/.test(text || '')), false, 'ChemRxiv line number prefixes are not rendered as text');
  }
  if (id === 'eartharxiv') {
    assert.equal(await storedPreprintPage.locator('.ocr-markdown-paragraph').evaluateAll((nodes) => nodes.some((node) => /^\s*51\s*(?:\n|$)\s*52\s*(?:\n|$)/.test(node.textContent || ''))), false, 'EarthArXiv standalone line-number runs are not rendered as headings');
  }
  if (id === 'researchsquare') {
    assert.equal(await storedPreprintPage.locator('.ocr-page[data-page="12"]').textContent().then((text) => !/img-\d+\.jpeg/i.test(text || '')), true, 'ResearchSquare OCR image placeholders are not rendered as manuscript text');
    assert.ok(await storedPreprintPage.locator('.ocr-page[data-page="12"] .ocr-figure').count() > 0, 'ResearchSquare OCR figures remain rendered');
  }
  const review = JSON.parse(fs.readFileSync(new URL(`../public/data/stored/${id}.json`, import.meta.url)));
  const groups = {
    authors: review.annotations['front-matter'].authors,
    affiliations: review.annotations['front-matter'].affiliations,
    abstract: review.annotations['front-matter'].abstract.text ? [review.annotations['front-matter'].abstract] : [],
    article: review.annotations.body.sections,
    keywords: review.annotations['front-matter'].keywords,
    references: review.annotations.references.references,
    tables: review.annotations.body.display_items.filter((item) => item.kind === 'table'),
    figures: review.annotations.body.display_items.filter((item) => item.kind === 'figure')
  };
  for (const [kind, items] of Object.entries(groups)) {
    assert.ok(items.length > 0, `${id} has ${kind} details`);
    assert.ok(items.every((item) => sourceExistsOnDeclaredPage(review, item)), `${id} ${kind} uses declared OCR source anchors`);
    await storedPreprintPage.locator(`[data-count="${kind}"]`).click();
    assert.equal(await storedPreprintPage.locator('#detailsPanelBody .detail-jump').count(), items.length, `${id} ${kind} renders every source link`);
    await storedPreprintPage.locator('#detailsPanelBody .detail-jump').first().click();
    assert.equal(await storedPreprintPage.locator('#htmlPane').evaluate((node) => !node.classList.contains('d-none')), true, `${id} ${kind} opens HTML source`);
    assert.equal(await storedPreprintPage.locator('.source-target-highlight, .ocr-page-source-target, .ocr-reference-target').count() > 0, true, `${id} ${kind} marks the source destination`);
  }
  await storedPreprintPage.close();
}
await browser.close();
console.log('mistral-3 reader shell: ok');
