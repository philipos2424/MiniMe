const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // In a monorepo, Next can't always statically trace require()'s that live
  // inside function bodies pointing to ../../packages/**. Force-include the
  // shared DB + crypto packages so Vercel uploads them alongside the serverless
  // functions.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  outputFileTracingIncludes: {
    // Key must be a filesystem glob relative to outputFileTracingRoot, NOT a URL path.
    // Using the URL-style '/api/**/*' silently skips tracing; this is the correct form.
    './apps/web/src/app/api/**': [
      './packages/db/**/*',
      './packages/shared/**/*',
    ],
  },
};

module.exports = nextConfig;
