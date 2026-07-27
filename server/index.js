import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { annotationPasses } from '../core/document-annotation.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
await loadLocalEnv();
const PORT = Number(process.env.PORT || 8893);
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const roots = [
  { prefix: '/vendor/bootstrap/', path: join(ROOT, 'node_modules/bootstrap/dist') },
  { prefix: '/vendor/bootstrap-icons/', path: join(ROOT, 'node_modules/bootstrap-icons/font') },
  { prefix: '/vendor/pdfjs/', path: join(ROOT, 'node_modules/pdfjs-dist') },
  { prefix: '/core/', path: join(ROOT, 'core') },
  { prefix: '/', path: join(ROOT, 'public') }
];
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_JSON_BYTES = Math.ceil(MAX_PDF_BYTES * 1.38) + 65536;
const DEV_REVISION_FILES = ['public/index.html', 'public/styles.css', 'public/home.js', 'public/app.js', 'public/assets/ambient-paper-v2.svg'];
async function loadLocalEnv() {
  try {
    const content = await readFile(join(ROOT, '.env'), 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    });
  } catch { /* OCR remains unavailable until a local key is configured. */ }
}
function headers() { return { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; img-src 'self' blob: data:; frame-src 'self' blob:;" }; }
async function serve(req, res) {
  const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const root = roots.find((entry) => entry.prefix === '/' ? !requestPath.startsWith('/vendor/') : requestPath.startsWith(entry.prefix));
  if (!root) return notFound(res);
  const suffix = root.prefix === '/' ? requestPath : requestPath.slice(root.prefix.length);
  const file = resolve(root.path, suffix.replace(/^\/+/, ''));
  if (relative(root.path, file).startsWith('..')) return notFound(res);
  try { const info = await stat(file); if (!info.isFile()) return notFound(res); const body = await readFile(file); const extension = extname(file); const cacheControl = ['.html', '.js', '.mjs', '.css', '.json'].includes(extension) ? 'no-cache' : 'public, max-age=3600'; res.writeHead(200, { ...headers(), 'Content-Type': MIME[extension] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': cacheControl }); res.end(body); } catch { notFound(res); }
}
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_JSON_BYTES) throw new Error('The PDF is larger than 4 MB.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function sendJson(res, value, status = 200) { const body = JSON.stringify(value); res.writeHead(status, { ...headers(), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' }); res.end(body); }
async function developmentRevision() { const changes = await Promise.all(DEV_REVISION_FILES.map(async (file) => (await stat(join(ROOT, file))).mtimeMs)); return String(Math.max(...changes)); }
async function analyse(req, res, annotationPass = null) {
  if (!process.env.MISTRAL_API_KEY) return sendJson(res, { error: 'Mistral API key is not configured.' }, 503);
  let payload;
  try { payload = await readJson(req); } catch (error) { return sendJson(res, { error: error.message || 'Invalid upload.' }, 400); }
  const base64 = String(payload?.base64 || ''); const bytes = Buffer.from(base64, 'base64');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || !bytes.length || bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 4).toString() !== '%PDF') return sendJson(res, { error: 'Upload a valid PDF up to 4 MB.' }, 400);
  const startedAt = Date.now(); let response;
  try {
    response = await fetch(`${String(process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1').replace(/\/+$/, '')}/ocr`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` },
      body: JSON.stringify({ model: process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest', document: { type: 'document_url', document_url: `data:application/pdf;base64,${base64}` }, include_blocks: true, include_image_base64: false, extract_header: true, extract_footer: true, table_format: 'html', ...(annotationPass ? { document_annotation_format: annotationPass.format(), document_annotation_prompt: annotationPass.prompt } : {}) }),
      signal: AbortSignal.timeout(Number(process.env.MISTRAL_OCR_TIMEOUT_MS || 180000))
    });
  } catch (error) { return sendJson(res, { error: error?.name === 'TimeoutError' ? 'Mistral document annotation timed out.' : 'Mistral OCR could not be reached.' }, error?.name === 'TimeoutError' ? 504 : 502); }
  const rawText = await response.text(); let raw = {}; try { raw = JSON.parse(rawText); } catch { /* handled by response status */ }
  if (!response.ok) return sendJson(res, { error: raw?.error?.message || raw?.message || `Mistral OCR failed (${response.status}).` }, response.status);
  if (!Array.isArray(raw.pages) || !raw.pages.length) return sendJson(res, { error: 'Mistral OCR did not return manuscript pages.' }, 502);
  if (!annotationPass) return sendJson(res, { fileName: String(payload.fileName || 'manuscript.pdf'), elapsedMs: Date.now() - startedAt, pages: raw.pages, model: raw.model || process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest', usage: raw.usage_info || null });
  let annotation = null;
  try { annotation = typeof raw.document_annotation === 'string' ? JSON.parse(raw.document_annotation) : raw.document_annotation; } catch { return sendJson(res, { error: 'Mistral returned an unreadable document annotation.' }, 502); }
  if (!annotation || typeof annotation !== 'object') return sendJson(res, { error: 'Mistral did not return the requested document annotation.' }, 502);
  return sendJson(res, { fileName: String(payload.fileName || 'manuscript.pdf'), elapsedMs: Date.now() - startedAt, annotation, model: raw.model || process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest', usage: raw.usage_info || null });
}
function notFound(res) { res.writeHead(404, { ...headers(), 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); }
createServer((req, res) => {
  const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  if (IS_DEVELOPMENT && req.method === 'GET' && pathname === '/__deskreview_dev_revision') return developmentRevision().then((revision) => sendJson(res, { revision })).catch(() => sendJson(res, { revision: 'unavailable' }));
  if (req.method === 'POST' && pathname === '/api/ocr/raw') return analyse(req, res);
  const annotationMatch = /^\/api\/ocr\/annotate\/(front-matter|body|references)$/.exec(pathname);
  if (req.method === 'POST' && annotationMatch) return analyse(req, res, annotationPasses[annotationMatch[1]]);
  return serve(req, res);
}).listen(PORT, '127.0.0.1', () => console.log(`deskreview-mistral-3 listening on http://127.0.0.1:${PORT}`));
