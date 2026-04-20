function panicMiddleware(business) {
  return (req, res, next) => {
    if (business && business.panic_mode) {
      return res.status(503).json({ error: 'Panic mode active' });
    }
    next();
  };
}

module.exports = { panicMiddleware };
