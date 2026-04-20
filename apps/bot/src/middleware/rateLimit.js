const rateLimitMap = new Map();

function rateLimit(maxRequests = 20, windowMs = 60000) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count++;
    rateLimitMap.set(key, entry);

    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    next();
  };
}

module.exports = { rateLimit };
