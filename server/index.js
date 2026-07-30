import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { annotationChunkPayload, citationAnnotationPayload, displayLinksPayload, MAX_PDF_BYTES, rawOcrPayload, referenceAnnotationPayload, referenceLinksPayload } from './analysis-service.js';
import { lookupAuthorProfiles } from './author-profile-service.js';
import { createRequestGuard } from './request-guard.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
await loadLocalEnv();
const PORT = Number(process.env.PORT || 8893);
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
const MAX_JSON_BYTES = Math.ceil(MAX_PDF_BYTES * 1.38) + 65536;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const roots = [
  { prefix: '/vendor/bootstrap/', path: join(ROOT, 'node_modules/bootstrap/dist') },
  { prefix: '/vendor/bootstrap-icons/', path: join(ROOT, 'node_modules/bootstrap-icons/font') },
  { prefix: '/vendor/pdfjs/', path: join(ROOT, 'node_modules/pdfjs-dist') },
  { prefix: '/core/', path: join(ROOT, 'core') },
  { prefix: '/', path: join(ROOT, 'public') }
];
const DEV_REVISION_FILES = ['public/index.html', 'public/styles.css', 'public/home.js', 'public/app.js', 'public/assets/ambient-paper-v2.svg'];
const requestGuard = createRequestGuard();
const authorProfileGuard = createRequestGuard({ env: { ...process.env, OCR_RATE_LIMIT_MAX: process.env.AUTHOR_PROFILE_RATE_LIMIT_MAX || '10', OCR_MAX_CONCURRENT: process.env.AUTHOR_PROFILE_MAX_CONCURRENT || '3' }, label: 'author profile' });

async function loadLocalEnv() {
  try {
    const content = await readFile(join(ROOT, '.env'), 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    });
  } catch { /* OCR remains unavailable until a local key is configured. */ }
}

function headers() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; img-src 'self' blob: data:; frame-src 'self' blob:;"
  };
}

async function serve(req, res) {
  const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const root = roots.find((entry) => entry.prefix === '/' ? !requestPath.startsWith('/vendor/') && !requestPath.startsWith('/core/') : requestPath.startsWith(entry.prefix));
  if (!root) return notFound(res);
  const suffix = root.prefix === '/' ? requestPath : requestPath.slice(root.prefix.length);
  const file = resolve(root.path, suffix.replace(/^\/+/, ''));
  if (relative(root.path, file).startsWith('..')) return notFound(res);
  try {
    const info = await stat(file);
    if (!info.isFile()) return notFound(res);
    const body = await readFile(file);
    const extension = extname(file);
    const cacheControl = ['.html', '.js', '.mjs', '.css', '.json'].includes(extension) ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { ...headers(), 'Content-Type': MIME[extension] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': cacheControl });
    res.end(body);
  } catch { notFound(res); }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new Error('The PDF is larger than 4 MB.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, { ...headers(), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

async function developmentRevision() {
  const changes = await Promise.all(DEV_REVISION_FILES.map(async (file) => (await stat(join(ROOT, file))).mtimeMs));
  return String(Math.max(...changes));
}

async function rawOcr(req, res) {
  const lease = requestGuard.acquire(req);
  if (lease.rejected) return sendJson(res, { error: lease.rejected.error }, lease.rejected.status);
  try { const payload = await readJson(req); const result = await rawOcrPayload(payload); return sendJson(res, result.value, result.status); }
  catch (error) { return sendJson(res, { error: error.message || 'Invalid upload.' }, 400); }
  finally { lease.release(); }
}

async function annotationChunk(req, res) {
  const lease = requestGuard.acquire(req);
  if (lease.rejected) return sendJson(res, { error: lease.rejected.error }, lease.rejected.status);
  try { const payload = await readJson(req); const result = await annotationChunkPayload(payload); return sendJson(res, result.value, result.status); }
  catch (error) { return sendJson(res, { error: error.message || 'Invalid annotation request.' }, 400); }
  finally { lease.release(); }
}

async function referenceAnnotation(req, res) {
  const lease = requestGuard.acquire(req);
  if (lease.rejected) return sendJson(res, { error: lease.rejected.error }, lease.rejected.status);
  try { const payload = await readJson(req); const result = await referenceAnnotationPayload(payload); return sendJson(res, result.value, result.status); }
  catch (error) { return sendJson(res, { error: error.message || 'Invalid reference annotation request.' }, 400); }
  finally { lease.release(); }
}

async function citationAnnotation(req, res) {
  const lease = requestGuard.acquire(req);
  if (lease.rejected) return sendJson(res, { error: lease.rejected.error }, lease.rejected.status);
  try { const payload = await readJson(req); const result = await citationAnnotationPayload(payload); return sendJson(res, result.value, result.status); }
  catch (error) { return sendJson(res, { error: error.message || 'Invalid body citation annotation request.' }, 400); }
  finally { lease.release(); }
}

async function displayLinks(req, res) {
  const lease = requestGuard.acquire(req);
  if (lease.rejected) return sendJson(res, { error: lease.rejected.error }, lease.rejected.status);
  try { const payload = await readJson(req); const result = await displayLinksPayload(payload); return sendJson(res, result.value, result.status); }
  catch (error) { return sendJson(res, { error: error.message || 'Invalid source-link request.' }, 400); }
  finally { lease.release(); }
}

async function referenceLinks(req, res) {
  const lease = requestGuard.acquire(req);
  if (lease.rejected) return sendJson(res, { error: lease.rejected.error }, lease.rejected.status);
  try { const payload = await readJson(req); const result = await referenceLinksPayload(payload); return sendJson(res, result.value, result.status); }
  catch (error) { return sendJson(res, { error: error.message || 'Invalid reference-link request.' }, 400); }
  finally { lease.release(); }
}

async function authorProfiles(req, res) {
  const lease = authorProfileGuard.acquire(req);
  if (lease.rejected) return sendJson(res, { error: lease.rejected.error }, lease.rejected.status);
  try {
    const payload = await readJson(req);
    const result = await lookupAuthorProfiles(payload);
    return sendJson(res, result.value, result.status);
  } catch (error) {
    return sendJson(res, { error: error.message || 'Invalid author profile request.' }, 400);
  } finally {
    lease.release();
  }
}

function notFound(res) {
  res.writeHead(404, { ...headers(), 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

createServer((req, res) => {
  const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  if (IS_DEVELOPMENT && req.method === 'GET' && pathname === '/__deskreview_dev_revision') return developmentRevision().then((revision) => sendJson(res, { revision })).catch(() => sendJson(res, { revision: 'unavailable' }));
  if (req.method === 'POST' && pathname === '/api/ocr/raw') return rawOcr(req, res);
  if (req.method === 'POST' && pathname === '/api/ocr/annotate') return annotationChunk(req, res);
  if (req.method === 'POST' && pathname === '/api/ocr/citations') return citationAnnotation(req, res);
  if (req.method === 'POST' && pathname === '/api/ocr/references') return referenceAnnotation(req, res);
  if (req.method === 'POST' && pathname === '/api/ocr/display-links') return displayLinks(req, res);
  if (req.method === 'POST' && pathname === '/api/ocr/reference-links') return referenceLinks(req, res);
  if (req.method === 'POST' && pathname === '/api/author-profiles') return authorProfiles(req, res);
  return serve(req, res);
}).listen(PORT, '127.0.0.1', () => console.log(`deskreview-mistral-3 listening on http://127.0.0.1:${PORT}`));
