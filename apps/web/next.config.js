const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // In a monorepo, Next can't always statically trace require()'s that live
  // inside function bodies pointing to ../../packages/**. Force-include the
  // shared DB + crypto packages so Vercel uploads them alongside the serverless
  // functions.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  outputFileTracingIncludes: {
    '/api/**/*': [
      '../../packages/db/**/*',
      '../../packages/shared/**/*',
    ],
  },
};

module.exports = nextConfig;
