export function createRequestGuard({ env = process.env, now = () => Date.now(), label = 'OCR' } = {}) {
  const isProduction = env.NODE_ENV === 'production';
  const allowedOrigins = String(env.ALLOWED_ORIGINS || env.APP_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean);
  const windowMs = Math.max(1000, Number(env.OCR_RATE_LIMIT_WINDOW_MS || 60000));
  const limit = Math.max(1, Number(env.OCR_RATE_LIMIT_MAX || 5));
  const maximumConcurrent = Math.max(1, Number(env.OCR_MAX_CONCURRENT || 2));
  const attempts = new Map();
  let active = 0;

  function clientAddress(request) {
    if (env.TRUST_PROXY === 'true') return String(request.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    return request.socket?.remoteAddress || 'unknown';
  }

  function reject(request) {
    if (request.method !== 'POST') return null;
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return { status: 415, error: `Use application/json for ${label} requests.` };
    if (!isProduction) return null;
    if (!allowedOrigins.length) return { status: 503, error: `Production ${label.toLocaleLowerCase()} origin is not configured.` };
    const origin = String(request.headers.origin || '');
    if (!origin || !allowedOrigins.includes(origin)) return { status: 403, error: `This ${label.toLocaleLowerCase()} request origin is not allowed.` };
    return null;
  }

  function acquire(request) {
    const rejected = reject(request);
    if (rejected) return { rejected };
    if (!isProduction) {
      if (active >= maximumConcurrent) return { rejected: { status: 429, error: `The ${label.toLocaleLowerCase()} service is busy. Please try again shortly.` } };
      active += 1;
      return { release: () => { active = Math.max(0, active - 1); } };
    }
    const address = clientAddress(request);
    const cutoff = now() - windowMs;
    const recent = (attempts.get(address) || []).filter((time) => time > cutoff);
    if (recent.length >= limit) return { rejected: { status: 429, error: `Too many ${label.toLocaleLowerCase()} requests. Please wait and try again.` } };
    if (active >= maximumConcurrent) return { rejected: { status: 429, error: `The ${label.toLocaleLowerCase()} service is busy. Please try again shortly.` } };
    recent.push(now()); attempts.set(address, recent); active += 1;
    return { release: () => { active = Math.max(0, active - 1); } };
  }

  return { acquire };
}
