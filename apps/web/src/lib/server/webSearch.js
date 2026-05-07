/**
 * Lightweight web search via DuckDuckGo HTML.
 * No API key required; results are scraped from the public HTML endpoint.
 * Returns up to 8 {title, url, snippet} results.
 */
export async function searchWeb(query, { count = 8 } = {}) {
  if (!query || !query.trim()) return [];
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (MiniMe-Agent/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && results.length < count) {
      const rawUrl = m[1];
      // DDG wraps with /l/?uddg=<encoded>
      const u = rawUrl.includes('uddg=') ? decodeURIComponent(rawUrl.split('uddg=')[1].split('&')[0]) : rawUrl;
      const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const snippet = m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (u && title) results.push({ title: title.slice(0, 200), url: u.slice(0, 500), snippet: snippet.slice(0, 300) });
    }
    return results;
  } catch (e) {
    return [];
  }
}
