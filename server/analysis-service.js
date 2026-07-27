import { requestDocumentAnalysis } from '../services/mistral-ocr.js';
import { hasValidDocumentAnnotation } from '../core/document-annotation-validation.js';

export const MAX_PDF_BYTES = 4 * 1024 * 1024;

function validPdfPayload(payload = {}) {
  const base64 = String(payload.base64 || '');
  const bytes = Buffer.from(base64, 'base64');
  return Boolean(base64 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64) && bytes.length && bytes.length <= MAX_PDF_BYTES && bytes.subarray(0, 4).toString() === '%PDF');
}

export async function analysePayload(payload, { fetchImpl = fetch, env = process.env } = {}) {
  if (!env.MISTRAL_API_KEY) return { status: 503, value: { error: 'Mistral API key is not configured.' } };
  if (!validPdfPayload(payload)) return { status: 400, value: { error: 'Upload a valid PDF up to 4 MB.' } };
  const startedAt = Date.now();
  let upstream;
  try {
    upstream = await requestDocumentAnalysis({ base64: String(payload.base64), fetchImpl, env });
  } catch (error) {
    return { status: error?.name === 'TimeoutError' ? 504 : 502, value: { error: error?.name === 'TimeoutError' ? 'Mistral document analysis timed out.' : 'Mistral OCR could not be reached.' } };
  }
  const { response, payload: raw } = upstream;
  if (!response.ok) return { status: response.status, value: { error: raw?.error?.message || raw?.message || `Mistral OCR failed (${response.status}).` } };
  if (!Array.isArray(raw.pages) || !raw.pages.length) return { status: 502, value: { error: 'Mistral OCR did not return manuscript pages.' } };
  let annotation;
  try { annotation = typeof raw.document_annotation === 'string' ? JSON.parse(raw.document_annotation) : raw.document_annotation; } catch { return { status: 502, value: { error: 'Mistral returned an unreadable document annotation.' } }; }
  if (!hasValidDocumentAnnotation(annotation)) return { status: 502, value: { error: 'Mistral returned an incomplete document annotation.' } };
  return {
    status: 200,
    value: {
      fileName: String(payload.fileName || 'manuscript.pdf'),
      elapsedMs: Date.now() - startedAt,
      pages: raw.pages,
      annotation,
      model: raw.model || env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest',
      usage: raw.usage_info || null
    }
  };
}
