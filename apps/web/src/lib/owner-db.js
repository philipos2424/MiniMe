'use client';
/**
 * Drop-in replacement for lib/supabase-browser's createClient() on owner
 * screens. `.from(...)` queries are sent to POST /api/owner/db (server-side,
 * scoped to the owner's business) instead of hitting Supabase with the anon
 * key, which RLS correctly blocks. Realtime (`channel`, `removeChannel`) and
 * `auth` still go to the browser client; screens keep their polling fallback.
 *
 * Supports the builder subset these screens use: select (with count/head),
 * insert, update, delete, eq/neq/gt/gte/lt/lte/in/is/like/ilike/or, order,
 * range, limit, single, maybeSingle. Results have the supabase-js shape
 * { data, error, count }.
 */
import { createClient as createBrowserClient } from './supabase-browser';

function initData() {
  try { return window.Telegram?.WebApp?.initData || ''; } catch { return ''; }
}

class Query {
  constructor(table) {
    this.spec = { table, op: 'select', filters: [], order: [] };
  }
  select(cols = '*', opts) {
    if (this.spec.op === 'select') {
      this.spec.select = cols;
      if (opts) this.spec.selectOpts = { count: opts.count, head: opts.head };
    } else {
      this.spec.select = cols; // returning rows from a write
    }
    return this;
  }
  insert(values) { this.spec.op = 'insert'; this.spec.values = values; return this; }
  update(values) { this.spec.op = 'update'; this.spec.values = values; return this; }
  delete() { this.spec.op = 'delete'; return this; }
  order(col, opts) { this.spec.order.push({ col, opts }); return this; }
  range(from, to) { this.spec.range = [from, to]; return this; }
  limit(n) { this.spec.limit = n; return this; }
  single() { this.spec.single = 'single'; return this; }
  maybeSingle() { this.spec.single = 'maybe'; return this; }

  async run() {
    try {
      const r = await fetch('/api/owner/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData() },
        body: JSON.stringify(this.spec),
      });
      const j = await r.json().catch(() => null);
      if (!j) return { data: null, error: { message: `HTTP ${r.status}` }, count: null };
      if (j.error) console.warn('[owner-db]', this.spec.table, this.spec.op, j.error.message);
      return { data: j.data ?? null, error: j.error || null, count: j.count ?? null };
    } catch (e) {
      return { data: null, error: { message: e.message || 'network_error' }, count: null };
    }
  }
  then(resolve, reject) { return this.run().then(resolve, reject); }
  catch(reject) { return this.run().catch(reject); }
}

for (const m of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike']) {
  Query.prototype[m] = function (col, val) { this.spec.filters.push({ m, a: [col, val] }); return this; };
}
Query.prototype.or = function (expr) { this.spec.filters.push({ m: 'or', a: [expr] }); return this; };

const noopChannel = { on() { return noopChannel; }, subscribe() { return noopChannel; } };

export function createClient() {
  const browser = createBrowserClient();
  return {
    from: (table) => new Query(table),
    channel: (...a) => (browser ? browser.channel(...a) : noopChannel),
    removeChannel: (...a) => (browser ? browser.removeChannel(...a) : undefined),
    auth: browser?.auth,
  };
}
