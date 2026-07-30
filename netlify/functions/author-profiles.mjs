import { lookupAuthorProfiles } from '../../server/author-profile-service.js';
import { createRequestGuard } from '../../server/request-guard.js';

const guard = createRequestGuard({ env: { ...process.env, TRUST_PROXY: 'true', OCR_RATE_LIMIT_MAX: process.env.AUTHOR_PROFILE_RATE_LIMIT_MAX || '10', OCR_MAX_CONCURRENT: process.env.AUTHOR_PROFILE_MAX_CONCURRENT || '3' }, label: 'author profile' });

export async function handler(event) {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
  const request = { method: event.httpMethod, headers, socket: { remoteAddress: 'netlify' } };
  const lease = guard.acquire(request);
  const responseHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
  if (lease.rejected) return { statusCode: lease.rejected.status, headers: responseHeaders, body: JSON.stringify({ error: lease.rejected.error }) };
  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
    const result = await lookupAuthorProfiles(JSON.parse(body));
    return { statusCode: result.status, headers: responseHeaders, body: JSON.stringify(result.value) };
  } catch {
    return { statusCode: 400, headers: responseHeaders, body: JSON.stringify({ error: 'Invalid author profile request.' }) };
  } finally {
    lease.release();
  }
}
