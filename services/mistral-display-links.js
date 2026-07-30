import { displayLinksFormat, displayLinksPrompt } from '../core/display-links-contract.js';

function endpoint(env) { return `${String(env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1').replace(/\/+$/, '')}/chat/completions`; }

/**
 * Bounded Mistral relation stage: ask only for relations between already
 * source-validated candidate handles. It does not reread the PDF.
 */
export async function requestDisplayLinks({ candidates, fetchImpl = fetch, env = process.env }) {
  const prompt = `${displayLinksPrompt}\n\nValidated display mention and candidate handles:\n${JSON.stringify(candidates)}`;
  const model = env.MISTRAL_DISPLAY_LINKS_MODEL || env.MISTRAL_SOURCE_LINKS_MODEL || env.MISTRAL_DOCUMENT_QNA_MODEL || 'mistral-large-2512';
  const request = {
    model,
    temperature: 0,
    top_p: 1,
    max_tokens: Number(env.MISTRAL_SOURCE_LINKS_MAX_TOKENS || 16384),
    response_format: displayLinksFormat(candidates),
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  };
  // Large does not expose a reasoning-effort control. Medium does, but this
  // exact-copy extraction should reserve its output budget for JSON either way.
  if (!model.startsWith('mistral-large')) request.reasoning_effort = env.MISTRAL_DOCUMENT_QNA_REASONING_EFFORT || 'none';
  const response = await fetchImpl(endpoint(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.MISTRAL_API_KEY}` },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(Number(env.MISTRAL_DISPLAY_LINKS_TIMEOUT_MS || env.MISTRAL_SOURCE_LINKS_TIMEOUT_MS || 180000))
  });
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { /* Caller reports the provider response failure. */ }
  return { response, payload };
}

export function displayLinksContent(payload = {}) {
  const content = payload?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    const finalText = content.filter((chunk) => chunk?.type === 'text' && typeof chunk.text === 'string').map((chunk) => chunk.text).join('');
    try { return JSON.parse(finalText); } catch { return null; }
  }
  if (typeof content === 'object' && content) return content;
  if (typeof content !== 'string') return null;
  try { return JSON.parse(content); } catch { return null; }
}
