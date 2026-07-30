import { referenceLinksFormat, referenceLinksPrompt } from '../core/reference-links-contract.js';
import { displayLinksContent } from './mistral-display-links.js';

function endpoint(env) {
  return `${String(env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1').replace(/\/+$/, '')}/chat/completions`;
}

export async function requestReferenceLinks({ candidates, fetchImpl = fetch, env = process.env }) {
  const model = env.MISTRAL_REFERENCE_LINKS_MODEL || env.MISTRAL_SOURCE_LINKS_MODEL || 'mistral-large-2512';
  const response = await fetchImpl(endpoint(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.MISTRAL_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      top_p: 1,
      max_tokens: Number(env.MISTRAL_REFERENCE_LINKS_MAX_TOKENS || 16384),
      response_format: referenceLinksFormat(candidates),
      messages: [{ role: 'user', content: `${referenceLinksPrompt}\n\nValidated reference and citation handles:\n${JSON.stringify(candidates)}` }]
    }),
    signal: AbortSignal.timeout(Number(env.MISTRAL_REFERENCE_LINKS_TIMEOUT_MS || 180000))
  });
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { /* Caller reports provider failure. */ }
  return { response, payload };
}

export { displayLinksContent as referenceLinksContent };
