import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.DESKREVIEW_M3_BASE_URL || 'http://127.0.0.1:8893';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

await page.goto(`${baseUrl}?review=medrxiv`);
await page.getByText('medrxiv.pdf · stored example', { exact: true }).waitFor({ state: 'visible' });
await page.locator('.pdf-text-layer span').first().waitFor({ state: 'attached', timeout: 30000 });

assert.ok(await page.locator('.pdf-text-layer span').count() > 0, 'PDF pages expose selectable text spans.');
assert.equal(await page.locator('.pdf-text-layer').first().evaluate((layer) => getComputedStyle(layer).userSelect), 'text');
assert.ok((await page.locator('.pdf-text-layer').first().textContent()).trim().length > 0, 'The text layer contains PDF text.');

await browser.close();
console.log('pdf text layer: ok');
