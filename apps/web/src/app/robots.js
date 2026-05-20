export default function robots() {
  const base = process.env.WEB_URL || 'https://minime-gamma.vercel.app';
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/directory', '/directory/'],
        disallow: ['/(dashboard)', '/api/', '/admin/'],
      },
    ],
    sitemap: `${base}/directory/sitemap.xml`,
  };
}
