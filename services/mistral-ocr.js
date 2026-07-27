import { documentAnnotationFormat, documentAnnotationPrompt } from '../core/document-annotation.js';

export async function requestDocumentAnalysis({ base64, fetchImpl = fetch, env = process.env }) {
  const baseUrl = String(env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1').replace(/\/+$/, '');
  const response = await fetchImpl(`${baseUrl}/ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.MISTRAL_API_KEY}` },
    body: JSON.stringify({
      model: env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest',
      document: { type: 'document_url', document_url: `data:application/pdf;base64,${base64}` },
      include_blocks: true,
      include_image_base64: false,
      extract_header: true,
      extract_footer: true,
      table_format: 'html',
      document_annotation_format: documentAnnotationFormat,
      document_annotation_prompt: documentAnnotationPrompt
    }),
    signal: AbortSignal.timeout(Number(env.MISTRAL_OCR_TIMEOUT_MS || 180000))
  });
  const rawText = await response.text();
  let payload = {};
  try { payload = JSON.parse(rawText); } catch { /* The status response below reports the provider failure. */ }
  return { response, payload };
}
