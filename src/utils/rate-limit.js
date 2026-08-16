// Guards for the routes that spend money.
//
// Every other route in this app reads a file. Two of them — the blocking run and
// the SSE run — start an Opus review, which costs real tokens and takes minutes.
// They sit on a public URL with no authentication, so without a limiter a single
// loop over `?force=1` is an unbounded bill.
//
// These are deliberately in-memory. On a serverless host each instance keeps its
// own counters, so the limit is per-instance rather than global — that is a
// weaker guarantee than a shared store would give, but it turns "unbounded" into
// "bounded per instance", needs no external dependency, and cannot itself fail
// closed and lock the owner out of their own lab. Deployments that need a hard
// ceiling should set PUBLIC_RUNS=off and run reviews from the CLI.

/** Trust the first hop only; anything further is attacker-controlled. */
export function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * A fixed-window counter. Windows are cheap to reason about and cannot be gamed
 * by more than a factor of two at the boundary, which is well inside tolerance
 * for a limit measured in runs per ten minutes.
 */
export function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();

  const sweep = (now) => {
    for (const [key, entry] of hits) {
      if (now - entry.start >= windowMs) hits.delete(key);
    }
  };

  return function rateLimit(req, res, next) {
    const now = Date.now();
    // The map is bounded by the number of distinct callers in one window; sweep
    // whenever it grows past anything a legitimate deployment would produce.
    if (hits.size > 5000) sweep(now);

    const key = clientKey(req);
    const entry = hits.get(key);

    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfter)));
      return res.status(429).json({
        error: 'rate_limited',
        message: message ?? `Too many requests. Try again in ${retryAfter}s.`,
      });
    }
    return next();
  };
}

/**
 * A ceiling on reviews running at once. Concurrent Opus runs are the expensive
 * failure mode: they multiply cost without finishing any faster.
 */
export function createConcurrencyGate({ max, message }) {
  let active = 0;

  return function gate(req, res, next) {
    if (active >= max) {
      res.setHeader('Retry-After', '30');
      return res.status(429).json({
        error: 'busy',
        message: message ?? `The lab is already running ${max} reviews. Try again shortly.`,
      });
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
    };
    // `close` covers a client that hangs up mid-stream; `finish` covers a normal
    // response. Without both, an abandoned SSE run would hold its slot forever.
    res.on('close', release);
    res.on('finish', release);
    return next();
  };
}

/** Deployments that should serve cached reviews only. */
export function createRunSwitch({ enabled, message }) {
  return function runSwitch(req, res, next) {
    if (enabled) return next();
    return res.status(403).json({
      error: 'runs_disabled',
      message: message ?? 'This deployment serves cached reviews only. Set PUBLIC_RUNS=on to enable runs.',
    });
  };
}
