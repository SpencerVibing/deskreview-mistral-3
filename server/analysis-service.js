import { requestAnnotationChunk, requestCitationAnnotation, requestRawOcr, requestReferenceAnnotation } from '../services/mistral-ocr.js';
import { hasValidDocumentAnnotation } from '../core/document-annotation-validation.js';
import { referenceAnnotationIssues, referenceAnnotationPages } from '../core/reference-annotation.js';
import { hasSourceLinkCandidates } from '../core/annotation-stages.js';
import { hasValidDisplayLinks } from '../core/display-links-contract.js';
import { requestDisplayLinks, displayLinksContent } from '../services/mistral-display-links.js';
import { requestReferenceLinks, referenceLinksContent } from '../services/mistral-reference-links.js';
import { hasReferenceLinkCandidates, hasValidReferenceLinks } from '../core/reference-links-contract.js';
import { validCitationAnnotation } from '../core/citation-annotation.js';

export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const MAX_SOURCE_LINK_PACKET_BYTES = 2 * 1024 * 1024;
export const MAX_REFERENCE_BLOCK_PACKET_BYTES = 512 * 1024;

function validPdfPayload(payload = {}) {
  const base64 = String(payload.base64 || '');
  const bytes = Buffer.from(base64, 'base64');
  return Boolean(base64 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64) && bytes.length && bytes.length <= MAX_PDF_BYTES && bytes.subarray(0, 4).toString() === '%PDF');
}

export async function rawOcrPayload(payload, { fetchImpl = fetch, env = process.env } = {}) {
  if (!env.MISTRAL_API_KEY) return { status: 503, value: { error: 'Mistral API key is not configured.' } };
  if (!validPdfPayload(payload)) return { status: 400, value: { error: 'Upload a valid PDF up to 4 MB.' } };
  try {
    const { response, payload: raw } = await requestRawOcr({ base64: String(payload.base64), fetchImpl, env });
    if (!response.ok) return { status: response.status, value: { error: raw?.error?.message || raw?.message || `Mistral OCR failed (${response.status}).` } };
    if (!Array.isArray(raw.pages) || !raw.pages.length) return { status: 502, value: { error: 'Mistral OCR did not return manuscript pages.' } };
    return { status: 200, value: { fileName: String(payload.fileName || 'manuscript.pdf'), elapsedMs: Number(raw?.usage_info?.elapsed_ms || 0), pages: raw.pages, model: raw.model || env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest', usage: raw.usage_info || null } };
  } catch (error) {
    return { status: error?.name === 'TimeoutError' ? 504 : 502, value: { error: error?.name === 'TimeoutError' ? 'Mistral OCR timed out.' : 'Mistral OCR could not be reached.' } };
  }
}

export async function annotationChunkPayload(payload, { fetchImpl = fetch, env = process.env } = {}) {
  if (!env.MISTRAL_API_KEY) return { status: 503, value: { error: 'Mistral API key is not configured.' } };
  if (!validPdfPayload(payload)) return { status: 400, value: { error: 'Upload a valid PDF up to 4 MB.' } };
  try {
    const { response, payload: result } = await requestAnnotationChunk({ base64: String(payload.base64), pages: payload.pages, sourcePageMap: payload.sourcePageMap, fetchImpl, env });
    if (!response.ok) return { status: response.status, value: { error: result?.error?.message || result?.message || 'Mistral annotation failed.' } };
    const annotation = typeof result.document_annotation === 'string' ? JSON.parse(result.document_annotation) : result.document_annotation;
    if (!hasValidDocumentAnnotation(annotation)) return { status: 502, value: { error: 'Mistral returned an incomplete annotation.' } };
    return { status: 200, value: { pages: payload.pages, ocrPages: Array.isArray(result.pages) ? result.pages : [], annotation } };
  } catch (error) {
    return { status: error?.name === 'TimeoutError' ? 504 : 502, value: { error: error?.name === 'TimeoutError' ? 'Mistral annotation timed out.' : 'Mistral annotation could not be read.' } };
  }
}

function validReferenceBlocks(value) {
  if (!Array.isArray(value) || !value.length || Buffer.byteLength(JSON.stringify(value)) > MAX_REFERENCE_BLOCK_PACKET_BYTES) return false;
  return value.every((block) => (
    block
    && Number.isInteger(block.pageIndex)
    && block.pageIndex >= 0
    && block.pageId === `ocr-page-${block.pageIndex}`
    && Number.isInteger(block.blockIndex)
    && block.blockIndex >= 0
    && block.blockId === `ocr-block-${block.pageIndex}-${block.blockIndex}`
    && typeof block.text === 'string'
    && block.text.trim().length > 0
  ));
}

export async function referenceAnnotationPayload(payload, { fetchImpl = fetch, env = process.env } = {}) {
  if (!env.MISTRAL_API_KEY) return { status: 503, value: { error: 'Mistral API key is not configured.' } };
  if (!validPdfPayload(payload)) return { status: 400, value: { error: 'Upload a valid PDF up to 4 MB.' } };
  if (!validReferenceBlocks(payload.referenceBlocks)) return { status: 422, value: { error: 'Raw OCR reference blocks are missing or malformed.' } };
  try {
    const pages = referenceAnnotationPages(payload.referenceBlocks);
    const { response, payload: result } = await requestReferenceAnnotation({
      base64: String(payload.base64),
      referenceBlocks: payload.referenceBlocks,
      fetchImpl,
      env
    });
    if (!response.ok) return { status: response.status, value: { error: result?.error?.message || result?.message || 'Mistral reference annotation failed.' } };
    const annotation = typeof result.document_annotation === 'string' ? JSON.parse(result.document_annotation) : result.document_annotation;
    const issues = referenceAnnotationIssues(annotation, payload.referenceBlocks);
    if (issues.length) return { status: 502, value: { error: 'Mistral returned ungrounded reference details.', issues } };
    return {
      status: 200,
      value: {
        pages,
        references: annotation.references,
        model: result.model || env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest',
        usage: result.usage_info || null
      }
    };
  } catch (error) {
    return { status: error?.name === 'TimeoutError' ? 504 : 502, value: { error: error?.name === 'TimeoutError' ? 'Mistral reference annotation timed out.' : 'Mistral reference annotation could not be read.' } };
  }
}

export async function citationAnnotationPayload(payload, { fetchImpl = fetch, env = process.env } = {}) {
  if (!env.MISTRAL_API_KEY) return { status: 503, value: { error: 'Mistral API key is not configured.' } };
  if (!validPdfPayload(payload)) return { status: 400, value: { error: 'Upload a valid PDF up to 4 MB.' } };
  try {
    const { response, payload: result } = await requestCitationAnnotation({
      base64: String(payload.base64),
      pages: payload.pages,
      fetchImpl,
      env
    });
    if (!response.ok) return { status: response.status, value: { error: result?.error?.message || result?.message || 'Mistral body citation annotation failed.' } };
    const annotation = typeof result.document_annotation === 'string' ? JSON.parse(result.document_annotation) : result.document_annotation;
    if (!validCitationAnnotation(annotation)) return { status: 502, value: { error: 'Mistral returned an incomplete body citation annotation.' } };
    return {
      status: 200,
      value: {
        pages: payload.pages,
        annotation,
        model: result.model || env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest',
        usage: result.usage_info || null
      }
    };
  } catch (error) {
    return { status: error?.name === 'TimeoutError' ? 504 : 502, value: { error: error?.name === 'TimeoutError' ? 'Mistral body citation annotation timed out.' : 'Mistral body citation annotation could not be read.' } };
  }
}

export async function displayLinksPayload(payload, { fetchImpl = fetch, env = process.env } = {}) {
  if (env.MISTRAL_DOCUMENT_QNA_SOURCE_LINKS_ENABLED !== 'true') return { status: 409, value: { error: 'Document QnA source links are not enabled for this environment.' } };
  if (!env.MISTRAL_API_KEY) return { status: 503, value: { error: 'Mistral API key is not configured.' } };
  const candidates = payload.candidates || {};
  if (!hasSourceLinkCandidates(candidates)) return { status: 422, value: { error: 'Mistral returned malformed source-link candidates.' } };
  if (Buffer.byteLength(JSON.stringify(candidates)) > MAX_SOURCE_LINK_PACKET_BYTES) return { status: 413, value: { error: 'This manuscript has too many source-link candidates for the bounded Document QnA stage.' } };
  try {
    const { response, payload: result } = await requestDisplayLinks({ candidates, fetchImpl, env });
    if (!response.ok) return { status: response.status, value: { error: result?.error?.message || result?.message || 'Mistral source-link analysis failed.' } };
    const links = displayLinksContent(result);
    if (!links || typeof links !== 'object') return { status: 502, value: { error: 'Mistral source-link response could not be read.' } };
    if (!hasValidDisplayLinks(links, candidates)) return { status: 502, value: { error: 'Mistral returned incomplete source links.' } };
    return { status: 200, value: { links, complete: true, model: result.model || env.MISTRAL_DISPLAY_LINKS_MODEL || env.MISTRAL_SOURCE_LINKS_MODEL || env.MISTRAL_DOCUMENT_QNA_MODEL || 'mistral-large-2512', usage: result.usage || null } };
  } catch (error) {
    return { status: error?.name === 'TimeoutError' ? 504 : 502, value: { error: error?.name === 'TimeoutError' ? 'Mistral source-link analysis timed out.' : 'Mistral source-link analysis could not be reached.' } };
  }
}

export async function referenceLinksPayload(payload, { fetchImpl = fetch, env = process.env } = {}) {
  if (env.MISTRAL_DOCUMENT_QNA_SOURCE_LINKS_ENABLED !== 'true') return { status: 409, value: { error: 'Reference source links are not enabled for this environment.' } };
  if (!env.MISTRAL_API_KEY) return { status: 503, value: { error: 'Mistral API key is not configured.' } };
  const candidates = payload.candidates || {};
  if (!hasReferenceLinkCandidates(candidates)) return { status: 422, value: { error: 'Mistral returned malformed reference-link candidates.' } };
  if (Buffer.byteLength(JSON.stringify(candidates)) > MAX_SOURCE_LINK_PACKET_BYTES) return { status: 413, value: { error: 'This manuscript has too many reference-link candidates for the bounded relation stage.' } };
  try {
    const { response, payload: result } = await requestReferenceLinks({ candidates, fetchImpl, env });
    if (!response.ok) return { status: response.status, value: { error: result?.error?.message || result?.message || 'Mistral reference-link analysis failed.' } };
    const links = referenceLinksContent(result);
    if (!links || typeof links !== 'object') return { status: 502, value: { error: 'Mistral reference-link response could not be read.' } };
    if (!hasValidReferenceLinks(links, candidates)) return { status: 502, value: { error: 'Mistral returned incomplete reference links.' } };
    return { status: 200, value: { links, complete: true, model: result.model || env.MISTRAL_REFERENCE_LINKS_MODEL || env.MISTRAL_SOURCE_LINKS_MODEL || 'mistral-large-2512', usage: result.usage || null } };
  } catch (error) {
    return { status: error?.name === 'TimeoutError' ? 504 : 502, value: { error: error?.name === 'TimeoutError' ? 'Mistral reference-link analysis timed out.' : 'Mistral reference-link analysis could not be reached.' } };
  }
}
