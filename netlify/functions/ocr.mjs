import { analysePayload } from '../../server/analysis-service.js';
import { createRequestGuard } from '../../server/request-guard.js';

const guard = createRequestGuard({ env: { ...process.env, TRUST_PROXY: 'true' } });

function securityHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin'
  };
}
export async function handler(event) {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
  const request = { method: event.httpMethod, headers, socket: { remoteAddress: 'netlify' } };
  const lease = guard.acquire(request);
  if (lease.rejected) return { statusCode: lease.rejected.status, headers: securityHeaders(), body: JSON.stringify({ error: lease.rejected.error }) };
  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
    const result = await analysePayload(JSON.parse(body));
    return { statusCode: result.status, headers: securityHeaders(), body: JSON.stringify(result.value) };
  } catch {
    return { statusCode: 400, headers: securityHeaders(), body: JSON.stringify({ error: 'Invalid upload.' }) };
  } finally {
    lease.release();
  }
}
