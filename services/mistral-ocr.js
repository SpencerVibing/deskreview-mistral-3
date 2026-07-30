import { assertAnnotationPageRange, assertCompactAnnotationFormat } from '../core/mistral-annotation-contract.js';
import { documentAnnotationFormatForPages, documentAnnotationPromptForPages } from '../core/document-annotation.js';
import { referenceAnnotationFormat, referenceAnnotationPages, referenceAnnotationPrompt } from '../core/reference-annotation.js';
import { citationAnnotationFormat, citationAnnotationPrompt } from '../core/citation-annotation.js';

function endpoint(env) { return `${String(env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1').replace(/\/+$/, '')}/ocr`; }

async function postOcr(body, { fetchImpl, env }) {
  const response = await fetchImpl(endpoint(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.MISTRAL_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(env.MISTRAL_OCR_TIMEOUT_MS || 180000))
  });
  const rawText = await response.text();
  let payload = {};
  try { payload = JSON.parse(rawText); } catch { /* The caller reports the provider failure. */ }
  return { response, payload };
}

function sharedRequest(base64, env) {
  return {
    model: env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest',
    document: { type: 'document_url', document_url: `data:application/pdf;base64,${base64}` }
  };
}

/** Full-document raw OCR request. This is the only reader source of truth. */
export function requestRawOcr({ base64, fetchImpl = fetch, env = process.env }) {
  return postOcr({
    ...sharedRequest(base64, env),
    include_blocks: true,
    include_image_base64: false,
    extract_header: true,
    extract_footer: true,
    table_format: 'html'
  }, { fetchImpl, env });
}

/** One documented, explicit annotation chunk of at most eight zero-based pages. */
export function requestAnnotationChunk({ base64, pages, sourcePageMap = [], format, prompt, fetchImpl = fetch, env = process.env }) {
  assertAnnotationPageRange(pages);
  const annotationFormat = format || documentAnnotationFormatForPages(pages, sourcePageMap);
  assertCompactAnnotationFormat(annotationFormat);
  return postOcr({
    ...sharedRequest(base64, env),
    pages,
    include_blocks: true,
    include_image_base64: false,
    extract_header: true,
    extract_footer: true,
    table_format: 'html',
    document_annotation_format: annotationFormat,
    document_annotation_prompt: prompt || documentAnnotationPromptForPages(pages, sourcePageMap)
  }, { fetchImpl, env });
}

/** One bounded bibliography-only annotation request over OCR-selected pages. */
export function requestReferenceAnnotation({ base64, referenceBlocks, fetchImpl = fetch, env = process.env }) {
  const pages = referenceAnnotationPages(referenceBlocks);
  const annotationFormat = referenceAnnotationFormat(referenceBlocks);
  assertAnnotationPageRange(pages);
  assertCompactAnnotationFormat(annotationFormat);
  return postOcr({
    ...sharedRequest(base64, env),
    pages,
    include_blocks: true,
    include_image_base64: false,
    extract_header: true,
    extract_footer: true,
    table_format: 'html',
    document_annotation_format: annotationFormat,
    document_annotation_prompt: referenceAnnotationPrompt(referenceBlocks)
  }, { fetchImpl, env });
}

/** One bounded body-citation-only annotation request over model-selected article pages. */
export function requestCitationAnnotation({ base64, pages, fetchImpl = fetch, env = process.env }) {
  assertAnnotationPageRange(pages);
  return postOcr({
    ...sharedRequest(base64, env),
    pages,
    include_blocks: true,
    include_image_base64: false,
    extract_header: true,
    extract_footer: true,
    table_format: 'html',
    document_annotation_format: citationAnnotationFormat,
    document_annotation_prompt: citationAnnotationPrompt
  }, { fetchImpl, env });
}
