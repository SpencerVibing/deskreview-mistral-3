import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.DESKREVIEW_M3_BASE_URL || 'http://127.0.0.1:8893';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
async function hideModal(page, selector) {
  await page.evaluate((modalSelector) => {
    const modal = document.querySelector(modalSelector);
    const instance = window.bootstrap?.Modal.getInstance(modal);
    if (instance) instance.hide();
    if (modal) {
      modal.classList.remove('show');
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      modal.removeAttribute('aria-modal');
      modal.removeAttribute('role');
      document.querySelectorAll('.modal-backdrop').forEach((node) => node.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('padding-right');
    }
  }, selector);
  await page.locator(selector).waitFor({ state: 'hidden' });
}
await context.route('**/api/author-profiles', async (route) => {
  const payload = JSON.parse(route.request().postData() || '{}');
  const authors = (payload.authors || []).map((author, index) => {
    const name = String(author?.text || '');
    if (index === 0) return { name, status: 'found', openAlexUrl: 'https://openalex.org/A123', orcidUrl: 'https://orcid.org/0000-0001-2345-6789', worksCount: 6, citedByCount: 31 };
    return { name, status: 'not_found', googleScholarUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(name)}` };
  });
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: 'openalex', authors }) });
});
const page = await context.newPage();
const source = (pageIndex, blockIndex, quote) => ({ ocr_page_id: `ocr-page-${pageIndex}`, ocr_block_id: `ocr-block-${pageIndex}-${blockIndex}`, exact_quote: quote });
const raw = {
  fileName: 'fixture.pdf', elapsedMs: 3100,
  pages: [{ markdown: '# **Paper title**\n\nAda Author\n\nCompiler Lab\n\nAbstract\n\n## Methods\n\nResults are presented in Table 1. Figure 1 illustrates the outcome. Prior work supports this finding [1].\n\nTable 1 source caption\n\nFigure 1 source caption', tables: [{ content: '<table><tr><td>Example cell</td></tr></table>' }], blocks: [{ type: 'title', content: '# Paper title' }, { type: 'text', content: 'Ada Author' }, { type: 'text', content: 'Compiler Lab' }, { type: 'text', content: 'Abstract' }, { type: 'title', content: '# Discussion' }, { type: 'heading', content: '## Methods' }, { type: 'text', content: 'Results are presented in Table 1. Figure 1 illustrates the outcome. Prior work supports this finding [1].' }, { type: 'text', content: 'Table 1 source caption' }, { type: 'image', content: 'Figure 1 source caption' }] }, { markdown: '# References\n\n1. Example reference. 2. Second reference.', tables: [], blocks: [{ type: 'heading', content: '# References' }, { type: 'references', content: '1. Example reference. 2. Second reference.' }] }]
};
const annotationChunk = {
  front_matter: {
    titles: [{ id: 'title', label: 'Paper title', item_exact_quote: 'Paper title', source: source(0, 0, 'Paper title') }],
    authors: [{ id: 'author', label: 'Ada Author', orcid: '', source: source(0, 1, 'Ada Author') }],
    affiliations: [{ id: 'affiliation', label: 'Compiler Lab', item_exact_quote: 'Compiler Lab', source: source(0, 2, 'Compiler Lab') }],
    author_affiliation_links: [{ author_id: 'author', affiliation_id: 'affiliation' }],
    keywords: [{ id: 'keyword', label: 'Unconfirmed keyword', item_exact_quote: 'Unconfirmed keyword', source: source(0, 3, 'Not in OCR text') }],
    abstracts: [{ source: source(0, 3, 'Abstract') }]
  },
  body: { sections: [{ id: 'methods', heading: 'Methods', level: 1, source: source(0, 5, 'Methods') }], prose_block_types: { 'ocr-block-0-6 :: Results are presented in Table 1. Figure 1 illustrates the outcome. Prior work supports this finding [1].': 'article' }, display_mentions: [{ id: 'dm1', label: 'Table 1', item_exact_quote: 'Table 1', source: source(0, 6, 'Results are presented in Table 1.') }, { id: 'dm2', label: 'Figure 1', item_exact_quote: 'Figure 1', source: source(0, 6, 'Figure 1 illustrates the outcome.') }], citation_mentions: [{ id: 'cm1', label: '[1]', item_exact_quote: '[1]', source: source(0, 6, 'Prior work supports this finding [1].') }] },
  displays: { entries: [{ id: 'table', kind: 'table', label: 'Table 1', source: source(0, 7, 'Table 1 source caption') }, { id: 'figure', kind: 'figure', label: 'Figure 1', source: source(0, 8, 'Figure 1 source caption') }] }
};
const referenceResult = {
  pages: [1],
  references: [{ id: 'ref-1', text: 'Example reference.', source: source(1, 1, 'Example reference.') }, { id: 'ref-2', text: 'Second reference.', source: source(1, 1, 'Second reference.') }]
};
const ocrRequestOrder = [];
await page.route('**/api/ocr/**', async (route) => {
  const url = route.request().url();
  ocrRequestOrder.push(url.split('/').at(-1));
  if (url.endsWith('/raw')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(raw) });
  if (url.endsWith('/annotate')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pages: [0, 1], ocrPages: [{ markdown: 'changed annotation OCR page', blocks: [{ type: 'text', content: 'changed annotation OCR page' }] }], annotation: annotationChunk }) });
  if (url.endsWith('/references')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(referenceResult) });
  if (url.endsWith('/citations')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pages: [0], annotation: { citation_mentions: [{ label: '[1]', context_quote: 'Prior work supports this finding [1].' }] } }) });
  if (url.endsWith('/display-links')) {
    const body = JSON.parse(route.request().postData() || '{}');
    assert.equal(body.base64, undefined, 'Source links must use validated candidates, not the PDF.');
    const candidates = body.candidates || {};
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ links: {
      display_mappings: (candidates.display_mentions || []).map((mention, index) => ({ mention_handle: mention.handle, display_handles: candidates.displays?.[index]?.handle ? [candidates.displays[index].handle] : [] })).filter((mapping) => mapping.display_handles.length),
      unmatched_display_mentions: [],
      unmentioned_display_handles: []
    } }) });
  }
  if (url.endsWith('/reference-links')) {
    const body = JSON.parse(route.request().postData() || '{}');
    assert.equal(body.base64, undefined, 'Reference links must use validated handles, not the PDF.');
    const candidates = body.candidates || {};
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ links: {
      citation_mappings: [{ citation_handle: candidates.citation_mentions[0].handle, reference_handles: [candidates.references[0].handle] }],
      unmatched_citation_handles: []
    } }) });
  }
  throw new Error(`Unexpected OCR route: ${url}`);
});
await page.goto(baseUrl);
assert.equal(await page.locator('#homeView').evaluate((node) => !node.classList.contains('d-none')), true);
	assert.equal(await page.locator('#exampleManuscriptList .example-card').count(), 5);
	assert.equal(await page.locator('#exampleManuscriptList .example-card').filter({ hasText: /chemRxiv\s+·\s+2025\s+·\s+preprint/ }).count(), 1);
	assert.equal(await page.locator('#exampleManuscriptList [data-example-id="oraktx"]').count(), 0);
	assert.equal(await page.locator('#featureSection .home-feature-story').count(), 4);
	assert.equal(await page.locator('#featureSection .carousel').count(), 4);
	assert.equal(await page.locator('.integration-logo-item').count(), 6);
assert.equal(await page.locator('[data-home-lead]').getAttribute('aria-label'), 'DeskReview identifies the right reporting guides for your research manuscript, audits it for compliance, and delivers detailed, verifiable results in minutes.');
await page.locator('[data-home-lead].is-complete').waitFor({ state: 'attached', timeout: 5000 });
	assert.equal(await page.locator('.home-hero-section').filter({ hasText: /Avoid preventable desk rejections/ }).count(), 1);
	assert.equal(await page.locator('#pricing').filter({ hasText: /Choose the plan that fits how often you review manuscripts/ }).count(), 1);
	assert.equal(await page.locator('.home-footer a[href="#featureSection"]').count(), 1);
	for (const href of ['/team.html', '/download.html', '/privacy.html', '/terms.html', '/assets/copyright/copyright.txt']) {
	  assert.equal(await page.locator(`.home-footer a[href="${href}"]`).count(), 1);
	}
await page.locator('.home-preview').click();
await page.locator('#homeDemoModal.show').waitFor({ state: 'visible' });
assert.equal(await page.locator('#homeDemoVideo source').getAttribute('src'), '/assets/demo.mp4');
await page.evaluate(() => {
  const modal = document.querySelector('#homeDemoModal');
  modal.classList.remove('show');
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  modal.removeAttribute('aria-modal');
  modal.removeAttribute('role');
  document.querySelectorAll('.modal-backdrop').forEach((node) => node.remove());
  document.body.classList.remove('modal-open');
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('padding-right');
});
await page.locator('#homeDemoModal').waitFor({ state: 'hidden' });
await page.locator('[data-example-id="chemrxiv"]').click();
await page.getByText('chemRxiv.pdf · stored example', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await page.locator('[data-count="references"] strong').textContent(), '63');
await page.goto(baseUrl);
await page.locator('[data-example-id="medrxiv"]').click();
await page.getByText('medrxiv.pdf · stored example', { exact: true }).waitFor({ state: 'visible' });
await page.locator('#annotationContractButton').waitFor({ state: 'visible' });
await page.locator('#annotationContractButton').click();
await page.locator('#annotationContractModal.show').waitFor({ state: 'visible' });
assert.match(await page.locator('#annotationFormatCode').textContent(), /deskreview_document_annotation_v16/);
assert.doesNotMatch(await page.locator('#annotationFormatCode').textContent(), /reference_audit/);
assert.match(await page.locator('#annotationPromptText').textContent(), /Return only visible information/);
assert.equal(await page.locator('#annotationFormatOverview > .annotation-schema-group').count(), 3);
await page.locator('#annotationContractTab').click();
await page.locator('[data-schema-path="front_matter"]').click();
await page.locator('[data-schema-path="front_matter.authors"]').waitFor({ state: 'visible' });
assert.match(await page.locator('[data-schema-path="front_matter.authors"]').textContent(), /Every visible human byline author/);
assert.match(await page.locator('[data-schema-path="front_matter.authors"]').textContent(), /Array · object/);
assert.match(await page.locator('[data-schema-path="front_matter.authors"]').textContent(), /Required/);
await page.locator('[data-schema-path="front_matter.authors"]').click();
await page.locator('[data-schema-path="front_matter.authors[].label"]').waitFor({ state: 'visible' });
assert.match(await page.locator('[data-schema-path="front_matter.authors[].label"]').textContent(), /One author name copied verbatim/);
assert.equal(await page.locator('#annotationPromptInstructions > li').count(), 3);
await page.locator('#annotationSourceTab').click();
assert.match(await page.locator('#annotationSourceScopeSummary').textContent(), /source scopes identified/);
assert.equal(await page.locator('#annotationSourceScopeList > .accordion-item').count(), 9);
assert.deepEqual(
  await page.locator('#annotationSourceScopeList > .accordion-item').evaluateAll((items) => items.map((item) => item.dataset.sourceScope)),
  ['title', 'authors', 'affiliations', 'abstract', 'keywords', 'article', 'tables', 'figures', 'references']
);
assert.equal(await page.locator('[data-source-scope="references"] .list-group-item').count(), 22);
assert.match(await page.locator('#annotationCombinedReferenceText').textContent(), /ocr-block-/);
await page.locator('#bodyCitationsTab').click();
assert.match(await page.locator('#citationAnnotationFormatCode').textContent(), /deskreview_body_citations_v1/);
assert.match(await page.locator('#citationGroundingAuditMetrics').textContent(), /Returned/);
assert.match(await page.locator('#citationGroundingAudit').textContent(), /No focused body-citation extraction ranges are available/);
await page.locator('#documentQnaTab').click();
assert.match(await page.locator('#documentQnaOverview').textContent(), /Reference relations/);
await page.locator('#runtimeSummaryTab').click();
assert.equal(await page.locator('#runtimeFlowDiagram .runtime-flow-stage').count(), 8);
assert.equal(await page.locator('#runtimeCategoryFlow [data-runtime-result]').count(), 8);
assert.match(await page.locator('#runtimeSummaryMetrics').textContent(), /Counts ready/);
await page.locator('#runtimeCategoryFlow [data-runtime-result="references"] button').click();
await page.locator('#runtime-dependencies-references.show').waitFor({ state: 'visible' });
assert.equal(await page.locator('#runtime-dependencies-references .runtime-dependency-step').count(), 5);
assert.equal(await page.locator('#runtimeSummarySections').getByText('OCR and annotation ready', { exact: true }).count(), 1);
await hideModal(page, '#annotationContractModal');
await page.locator('[data-count="affiliations"]').click();
await page.locator('#detailsPanelBody').getByText('Universidade Federal do Rio Grande do Sul (UFRGS), Porto Alegre, Brazil', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await page.locator('#detailsPanelBody').getByText('This item is available, but its exact source link could not be confirmed.', { exact: true }).count() > 0, true);
assert.equal(await page.locator('#detailsPanelBody').getByText('Open source in HTML', { exact: true }).count(), 0);
await page.goto(baseUrl);
await page.evaluate(() => {
  document.querySelector('#homeView')?.classList.add('d-none');
  document.querySelector('#reader')?.classList.remove('d-none');
});
await page.locator('#pdfEmptyUploadButton').filter({ hasText: 'Upload PDF' }).waitFor({ state: 'visible' });
await page.goto(baseUrl);
await page.locator('#pdfInput').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
await page.locator('.toc-button').first().waitFor({ state: 'visible' });
assert.equal(await page.locator('.toc-button').count(), 4);
assert.equal(await page.locator('.toc-button').first().textContent(), 'Title');
assert.equal(await page.locator('.toc-button').filter({ hasText: /^Title$/ }).count(), 1);
assert.equal(await page.locator('[data-count="tables"] strong').textContent(), '1');
assert.equal(await page.locator('[data-count="figures"] strong').textContent(), '1');
assert.equal(await page.locator('[data-count="references"] strong').textContent(), '2');
assert.equal(await page.locator('[data-count="article"] strong').textContent(), '17', 'Article count is derived from model-selected OCR prose blocks, not section.word_count');
assert.equal(await page.locator('[data-count="authors"]').evaluate((el) => el.classList.contains('is-loading')), false);
assert.equal(await page.locator('[data-count="references"]').getAttribute('data-category-state'), 'ready');
assert.equal(await page.locator('[data-count="references"]').getAttribute('data-link-state'), 'ready');
assert.equal(await page.locator('[data-count="article"]').getAttribute('data-category-state'), 'ready');
assert.deepEqual(ocrRequestOrder.slice(0, 3), ['raw', 'references', 'annotate'], 'Reference inventory starts immediately beside the first broad annotation range.');
assert.equal(await page.locator('#htmlMode.is-html-ready').count(), 1);
assert.equal(await page.locator('.ocr-html strong').getByText('Paper title', { exact: true }).count(), 1);
assert.equal(await page.locator('.ocr-html table').count(), 1);
assert.equal(await page.locator('.ocr-html').getByText('tbl-0.html', { exact: true }).count(), 0);
await page.locator('[data-count="article"]').click();
assert.equal(await page.locator('#detailsPanelBody').getByText('17 words counted from 1 model-selected OCR block.', { exact: true }).count(), 1);
assert.equal(await page.locator('#detailsPanelBody').getByText('Results are presented in Table 1. Figure 1 illustrates the outcome. Prior work supports this finding [1].', { exact: true }).count(), 1);
await page.locator('#detailsPanelClose').click();
await page.locator('[data-count="authors"]').click();
await page.locator('#detailsPanelBody').getByText('Ada Author', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await page.locator('#detailsPanelBody').getByText('Ada Author', { exact: true }).count(), 1);
await page.locator('#detailsPanelBody [data-author-profile-link="openalex"]').waitFor({ state: 'visible' });
assert.equal(await page.locator('#detailsPanelBody [data-author-profile-link="orcid"]').count(), 1);
await page.locator('#detailsPanelClose').click();
await page.locator('[data-count="affiliations"]').click();
assert.equal(await page.locator('#detailsPanelBody').getByText('All 1 author linked to an affiliation and all 1 affiliation linked to an author.', { exact: true }).count(), 1);
assert.equal(await page.locator('#detailsPanelBody').getByText('Ada Author', { exact: true }).count(), 1);
await page.locator('#detailsPanelClose').click();
await page.locator('[data-count="tables"]').click();
assert.equal(await page.locator('#detailsPanel').evaluate((node) => node.classList.contains('is-open')), true);
assert.equal(await page.locator('#detailsPanelBody').getByText('1 occurrence in the body text', { exact: true }).count(), 1);
await page.locator('#detailsPanelBody .detail-occurrence-jump').click();
assert.equal(await page.locator('.source-target-highlight').count(), 1);
await page.locator('#detailsPanelClose').click();
await page.locator('[data-count="figures"]').click();
assert.equal(await page.locator('#detailsPanelBody').getByText('1 occurrence in the body text', { exact: true }).count(), 1);
await page.locator('#detailsPanelBody .detail-occurrence-jump').click();
assert.equal(await page.locator('.source-target-highlight').count(), 1);
await page.locator('#detailsPanelClose').click();
await page.locator('[data-count="references"]').click();
assert.equal(await page.locator('.ocr-reference-list li').count(), 2, 'A single OCR reference block renders as separate model-returned bibliography entries.');
await page.locator('#detailsPanelBody .detail-jump').first().click();
assert.equal(await page.locator('.source-target-highlight').count(), 1);
assert.equal(await page.locator('.source-target-highlight').textContent(), 'Example reference.');
assert.equal(await page.locator('.ocr-reference-list li').count(), 2, 'Reference rendering does not change the reference count.');
assert.equal(await page.locator('#detailsPanelBody').getByText('1 occurrence in the body text', { exact: true }).count(), 1);
assert.equal(await page.locator('#detailsPanelBody').getByText('Prior work supports this finding [1].', { exact: true }).count(), 1);
await page.locator('#detailsPanelBody .detail-occurrence-jump').click();
assert.equal(await page.locator('.source-target-highlight').textContent(), '[1]');
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
await page.locator('#customizeChecksModal').waitFor({ state: 'hidden' });
await page.locator('#guidelineSelectorModal').evaluate((node) => node.classList.add('show'));
await page.locator('#guidelineSelectorModal').evaluate((node) => { node.style.display = 'block'; });
await page.locator('[data-open-guideline="CONSORT"]').click();
assert.equal(await page.locator('#guidelineDetailSlider').evaluate((node) => node.classList.contains('is-open')), true);
await page.locator('#closeGuidelineDetailSlider').click();
await page.locator('#guidelineSelectorModal').evaluate((node) => { node.classList.remove('show'); node.style.display = ''; });
await page.locator('button[data-bs-target="#chatPane"]').click();
await page.waitForFunction(() => document.querySelector('#chatPane')?.classList.contains('show'));
assert.equal(await page.locator('#chatPane').evaluate((node) => node.classList.contains('show')), true);
assert.equal(await page.locator('#chatInput').count(), 1);
await page.locator('button[data-bs-target="#commentsPane"]').click();
await page.waitForFunction(() => document.querySelector('#commentsPane')?.classList.contains('show'));
assert.equal(await page.locator('#commentsPane').evaluate((node) => node.classList.contains('show')), true);
assert.equal(await page.locator('#commentsAccordion .accordion-button').count(), 3);
await page.locator('button[data-bs-target="#checksPane"]').click();
await page.waitForFunction(() => document.querySelector('#checksPane')?.classList.contains('show'));
assert.equal(await page.locator('[data-count="authors"] strong').textContent(), '1');
assert.equal(await page.locator('.toc-button').first().textContent(), 'Title');
await page.locator('[data-count="authors"]').click();
assert.equal(await page.locator('#detailsPanelBody').getByText('Ada Author', { exact: true }).count(), 1);
assert.equal(await page.locator('#detailsPanelBody').getByText('Open source in HTML', { exact: true }).count(), 0);
await page.locator('#detailsPanelBody .detail-jump').click();
assert.equal(await page.locator('#htmlPane').evaluate((node) => !node.classList.contains('d-none')), true);
assert.equal(await page.locator('.source-target-highlight').getByText('Ada Author', { exact: true }).count(), 1);
await page.locator('#detailsPanelClose').click();
await page.locator('[data-count="keywords"]').click();
assert.equal(await page.locator('#detailsPanelBody').getByText('Unconfirmed keyword', { exact: true }).count(), 0);
assert.equal(await page.locator('#detailsPanelBody').getByText('No item details were returned for this result.', { exact: true }).count(), 1);
await page.waitForTimeout(250);
const libraryPage = await page.context().newPage();
await libraryPage.route('**/api/ocr/**', (route) => route.abort());
await libraryPage.goto(baseUrl);
assert.equal(await libraryPage.locator('#examplesSection').evaluate((node) => !node.classList.contains('d-none')), true);
assert.equal(await libraryPage.locator('#storedReviewsSection').count(), 0);
await libraryPage.locator('#homeStoredReviewsButton').waitFor({ state: 'visible' });
await libraryPage.locator('#homeStoredReviewsButton').filter({ hasText: /Your deskreviews \(1\)/ }).waitFor({ state: 'visible' });
await libraryPage.locator('#homeStoredReviewsButton').click();
assert.equal(await libraryPage.locator('#reader').evaluate((node) => !node.classList.contains('d-none')), true);
await libraryPage.locator('#storedReviewsModal.show').waitFor({ state: 'visible' });
await libraryPage.locator('#storedReviewsModal label').filter({ hasText: 'Upload PDF' }).waitFor({ state: 'visible' });
await libraryPage.locator('#storedReviewsPdfInput').waitFor({ state: 'attached' });
await libraryPage.locator('#reviewLibraryBody').getByText('fixture.pdf', { exact: true }).waitFor({ state: 'visible' });
await libraryPage.locator('#reviewLibraryBody').getByText('fixture.pdf', { exact: true }).click();
await libraryPage.locator('#storedReviewsModal').waitFor({ state: 'hidden' });
await libraryPage.getByText('fixture.pdf · stored review', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await libraryPage.locator('#runtimeSummaryButton').count(), 0);
assert.equal(await libraryPage.locator('#runtimeSummaryModal').count(), 0);
await libraryPage.locator('#annotationContractButton').click();
await libraryPage.locator('#annotationContractModal.show').waitFor({ state: 'visible' });
await libraryPage.locator('#runtimeSummaryTab').click();
assert.equal(await libraryPage.locator('#runtimeSummarySections').getByText('Upload started', { exact: true }).count(), 1);
assert.equal(await libraryPage.locator('#runtimeSummarySections').getByText('Stored review opened', { exact: true }).count(), 0);
assert.equal(await libraryPage.locator('#runtimeSummarySections').getByText('Stored OCR ready', { exact: true }).count(), 0);
await hideModal(libraryPage, '#annotationContractModal');
await libraryPage.close();
const storedPage = await context.newPage();
await storedPage.route('**/api/ocr/**', (route) => route.abort());
await storedPage.goto(`${baseUrl}?review=medrxiv`);
await storedPage.getByText('medrxiv.pdf · stored example', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await storedPage.locator('[data-count="authors"] strong').textContent(), '23');
assert.equal(await storedPage.locator('.toc-button').filter({ hasText: /^Title$/ }).count(), 1);
assert.equal(await storedPage.locator('[data-count="references"] strong').textContent(), '22');
assert.equal(await storedPage.locator('.ocr-reference-list li').count(), 0, 'Stale stored anchors outside the cached OCR page range fail closed.');
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
await storedPage.locator('#annotationContractButton').click();
await storedPage.locator('#annotationContractModal.show').waitFor({ state: 'visible' });
await storedPage.locator('#runtimeSummaryTab').click();
assert.equal(await storedPage.locator('#runtimeSummarySections').getByText('OCR and annotation ready', { exact: true }).count(), 1);
assert.equal(await storedPage.locator('#runtimeSummarySections').getByText('Affiliation linkage', { exact: true }).count(), 1);
assert.equal(await storedPage.locator('#runtimeSummarySections').getByText('Stored review opened', { exact: true }).count(), 0);
assert.ok(await storedPage.locator('#runtimeSummarySections time').first().textContent().then((value) => value.startsWith('+')));
await hideModal(storedPage, '#annotationContractModal');
await storedPage.locator('[data-count="references"]').click();
assert.equal(await storedPage.locator('#detailsPanelBody').getByText('Open source in HTML', { exact: true }).count(), 0);
assert.equal(await storedPage.locator('#detailsPanelBody .detail-source-unavailable').count(), 22);
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
const oraktxPage = await context.newPage();
await oraktxPage.route('**/api/ocr/**', (route) => route.abort());
await oraktxPage.goto(`${baseUrl}?review=oraktx`);
await oraktxPage.getByText('ORAKTx.pdf · stored example', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await oraktxPage.locator('[data-count="keywords"] strong').textContent(), '6');
assert.equal(await oraktxPage.locator('[data-count="references"] strong').textContent(), '31');
assert.equal(await oraktxPage.locator('.ocr-reference-list li').count(), 0, 'Legacy ORAKTx reference anchors fail closed instead of rewriting cached OCR.');
await oraktxPage.close();
const chemrxivPage = await context.newPage();
await chemrxivPage.route('**/api/ocr/**', (route) => route.abort());
await chemrxivPage.goto(`${baseUrl}?review=chemrxiv`);
await chemrxivPage.getByText('chemRxiv.pdf · stored example', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await chemrxivPage.locator('[data-count="authors"] strong').textContent(), '5');
assert.equal(await chemrxivPage.locator('[data-count="references"] strong').textContent(), '63');
await chemrxivPage.locator('[data-count="authors"]').click();
await chemrxivPage.locator('[data-author-profile-link="openalex"]').first().waitFor({ state: 'visible' });
assert.equal(await chemrxivPage.locator('[data-author-profile-link="openalex"]').first().getAttribute('href'), 'https://openalex.org/A5020506639');
assert.equal(await chemrxivPage.locator('[data-author-profile-link="orcid"]').first().getAttribute('href'), 'https://orcid.org/0000-0003-0867-0319');
assert.equal(await chemrxivPage.locator('#detailsPanelBody').getByText('Open source in HTML', { exact: true }).count(), 0);
await chemrxivPage.locator('#detailsPanelClose').click();
await chemrxivPage.locator('[data-count="references"]').click();
await chemrxivPage.locator('#detailsPanelBody .detail-jump').first().click();
await chemrxivPage.locator('.ocr-reference-target').waitFor({ state: 'visible' });
assert.equal(await chemrxivPage.locator('.ocr-reference-target').count(), 1, 'A reference jump targets one bibliography item, not its containing OCR page');
assert.match(await chemrxivPage.locator('.ocr-reference-target').textContent(), /Cordell/);
assert.ok(await chemrxivPage.locator('.ocr-figure img').count() > 0, 'ChemRxiv OCR image assets are rendered');
assert.equal(await chemrxivPage.locator('.ocr-figure img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true, 'ChemRxiv figure image data URLs decode successfully');
await chemrxivPage.close();
const linkFailurePage = await context.newPage();
await linkFailurePage.route('**/api/author-profiles', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: 'openalex', authors: [] }) }));
await linkFailurePage.route('**/api/ocr/**', async (route) => {
  const url = route.request().url();
  if (url.endsWith('/raw')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(raw) });
  if (url.endsWith('/annotate')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pages: [0, 1], annotation: annotationChunk }) });
  if (url.endsWith('/references')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(referenceResult) });
  if (url.endsWith('/citations')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pages: [0], annotation: { citation_mentions: [{ label: '[1]', context_quote: 'Prior work supports this finding [1].' }] } }) });
  if (url.endsWith('/display-links')) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Linking unavailable.' }) });
  if (url.endsWith('/reference-links')) {
    const body = JSON.parse(route.request().postData() || '{}');
    const candidates = body.candidates || {};
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ links: {
      citation_mappings: [{ citation_handle: candidates.citation_mentions[0].handle, reference_handles: [candidates.references[0].handle] }],
      unmatched_citation_handles: []
    } }) });
  }
  throw new Error(`Unexpected OCR route: ${url}`);
});
await linkFailurePage.goto(baseUrl);
await linkFailurePage.locator('#pdfInput').setInputFiles({ name: 'link-failure.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
await linkFailurePage.getByText('fixture.pdf · review results ready', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await linkFailurePage.locator('[data-count="references"] strong').textContent(), '2', 'Source-link failure does not hide the finalized reference count.');
assert.equal(await linkFailurePage.locator('[data-count="references"]').getAttribute('data-category-state'), 'ready', 'Display-link failure does not affect bibliography readiness.');
assert.equal(await linkFailurePage.locator('[data-count="references"]').getAttribute('data-link-state'), 'ready');
assert.equal(await linkFailurePage.locator('[data-count="tables"]').getAttribute('data-category-state'), 'counted');
assert.equal(await linkFailurePage.locator('[data-count="tables"]').getAttribute('data-link-state'), 'unavailable');
await linkFailurePage.locator('[data-count="references"]').click();
assert.equal(await linkFailurePage.locator('#detailsPanelBody').getByText('1 occurrence in the body text', { exact: true }).count(), 1);
await linkFailurePage.close();
const chunkFailurePage = await context.newPage();
const chunkFailureRaw = {
  fileName: 'chunk-failure.pdf',
  elapsedMs: 1200,
  pages: Array.from({ length: 17 }, (_, index) => ({
    index,
    markdown: index === 16 ? '# References\n\n1. Late reference.' : `Page ${index + 1} body prose.`,
    tables: [],
    blocks: [{ type: index === 16 ? 'heading' : 'text', content: index === 16 ? '# References' : `Page ${index + 1} body prose.` }, ...(index === 16 ? [{ type: 'references', content: 'Late reference.' }] : [])]
  }))
};
const emptyAnnotation = (pages) => ({
  front_matter: { titles: [], authors: [], affiliations: [], author_affiliation_links: [], keywords: [], abstracts: [] },
  body: {
    sections: pages[0] === 0 ? [{ id: 'intro', heading: 'Introduction', level: 1, source: { ocr_page_index: 0, exact_quote: 'Page 1 body prose.' } }] : [],
    prose_block_types: Object.fromEntries(pages.map((pageIndex) => [`ocr-block-${pageIndex}-0 :: Page ${pageIndex + 1} body prose.`, pageIndex < 8 ? 'article' : 'excluded'])),
    display_mentions: [],
    citation_mentions: []
  },
  displays: { entries: [] }
});
const chunkFailureOrder = [];
await chunkFailurePage.route('**/api/author-profiles', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: 'openalex', authors: [] }) }));
await chunkFailurePage.route('**/api/ocr/**', async (route) => {
  const url = route.request().url();
  if (url.endsWith('/raw')) {
    chunkFailureOrder.push('raw');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(chunkFailureRaw) });
  }
  if (url.endsWith('/annotate')) {
    const body = JSON.parse(route.request().postData() || '{}');
    chunkFailureOrder.push(`annotate:${(body.pages || [])[0]}`);
    if ((body.pages || [])[0] === 8) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Middle chunk failed.' }) });
    const annotation = emptyAnnotation(body.pages || []);
    if ((body.pages || [])[0] === 16) {
      annotation.body.prose_block_types = { 'ocr-block-16-1 :: Late reference.': 'excluded' };
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pages: body.pages, annotation }) });
  }
  if (url.endsWith('/references')) {
    chunkFailureOrder.push('references');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ pages: [16], references: [{ id: 'late-reference', text: 'Late reference.', source: source(16, 1, 'Late reference.') }] }) });
  }
  if (url.endsWith('/display-links')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ links: { display_mappings: [], unmatched_display_mentions: [], unmentioned_display_handles: [] }, complete: true }) });
  throw new Error(`Unexpected OCR route: ${url}`);
});
await chunkFailurePage.goto(baseUrl);
await chunkFailurePage.locator('#pdfInput').setInputFiles({ name: 'chunk-failure.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
await chunkFailurePage.getByText('chunk-failure.pdf · review results ready', { exact: true }).waitFor({ state: 'visible' });
assert.deepEqual(chunkFailureOrder.slice(0, 4), ['raw', 'references', 'annotate:0', 'annotate:8']);
assert.equal(await chunkFailurePage.locator('[data-count="references"] strong').textContent(), '1', 'Reference inventory completes independently when a broad annotation range fails.');
assert.equal(await chunkFailurePage.locator('[data-count="article"] strong').textContent(), '—', 'Article count is not finalized when an annotation range failed.');
assert.equal(await chunkFailurePage.locator('[data-count="references"]').getAttribute('data-category-state'), 'counted');
assert.equal(await chunkFailurePage.locator('[data-count="article"]').getAttribute('data-category-state'), 'unavailable');
assert.equal(await chunkFailurePage.locator('[data-count="references"]').getAttribute('data-link-state'), 'unavailable');
assert.deepEqual(await chunkFailurePage.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('deskreview-mistral-3', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const request = db.transaction('reviews', 'readonly').objectStore('reviews').getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const review = request.result.find((item) => item.fileName === 'chunk-failure.pdf');
      resolve({
        rangeCount: review.annotationCoverage.ranges.length,
        completed: review.annotationCoverage.completed,
        failed: review.annotationCoverage.failed
      });
      db.close();
    };
  };
})), { rangeCount: 3, completed: ['annotation-range-0', 'annotation-range-2'], failed: ['annotation-range-1'] });
await chunkFailurePage.locator('[data-count="references"]').click();
assert.equal(await chunkFailurePage.locator('#detailsPanelBody').getByText('Late reference.', { exact: true }).count(), 1);
await chunkFailurePage.locator('#detailsPanelBody .detail-jump').click();
assert.equal(await chunkFailurePage.locator('.source-target-highlight').textContent(), 'Late reference.');
await chunkFailurePage.close();
for (const [id, file, authors, references] of [['chemrxiv', 'chemRxiv.pdf', '5', '63'], ['eartharxiv', 'EarthArXiv.pdf', '3', '47'], ['researchsquare', 'ResearchSquare.pdf', '8', '29'], ['psyarxiv', 'psyArXiv.pdf', '2', '64']]) {
  const storedPreprintPage = await context.newPage();
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
  await storedPreprintPage.close();
}
await browser.close();
console.log('mistral-3 reader shell: ok');
