/**
 * Owner data access for the Mini App, routed through the server.
 *
 * Why this exists: production has row-level security ON for conversations,
 * messages, customers, products, orders, customer_memory, reviews and
 * businesses, with NO policies, so the browser's anon-key client reads zero
 * rows and every write is rejected. The Chats, Customers, Products and chat
 * screens therefore showed "No conversations yet" for shops with hundreds of
 * conversations, and product / customer edits silently did nothing.
 *
 * The fix keeps anon at zero access. The browser sends a small query spec to
 * POST /api/owner/db; the server verifies Telegram initData, finds the owner's
 * business, and runs the spec with the service role, ALWAYS scoped to that
 * business. This module validates the spec and is shared by client and server.
 */

export const TABLES = {
  conversations:   { ops: ['select', 'update'] },
  messages:        { ops: ['select', 'update'] },
  customers:       { ops: ['select', 'update', 'insert'] },
  products:        { ops: ['select', 'insert', 'update', 'delete'] },
  orders:          { ops: ['select', 'update'] },
  customer_memory: { ops: ['select', 'insert', 'update', 'delete'] },
  reviews:         { ops: ['select'] },
  // The owner's own row only, keyed by id instead of business_id.
  businesses:      { ops: ['select', 'update'], scopeColumn: 'id' },
};

// Business columns an owner may change from these screens. Everything else on
// the business row (plan, subscription, owner id, bot token…) goes through
// dedicated API routes with their own checks.
export const BUSINESS_UPDATABLE = new Set([
  'notification_prefs', 'b2b_discoverable', 'description', 'tagline', 'category', 'keywords',
]);

export const FILTER_METHODS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike', 'or']);
export const MAX_ROWS = 1000;

// Never sent to the browser, at any depth (embedded rows included).
const SECRET_KEY = /(_enc$|secret|token|password|api_key|private_key)/i;

const COLUMN = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i;

export function scopeColumn(table) {
  return TABLES[table]?.scopeColumn || 'business_id';
}

function fail(reason) { return { ok: false, error: reason }; }

/**
 * Validate a spec. Returns { ok: true, spec } with a normalised copy, or
 * { ok: false, error }. Pure: no database, no business — the server adds the
 * business scope when it runs the query.
 */
export function validateSpec(raw) {
  if (!raw || typeof raw !== 'object') return fail('bad_spec');
  const { table, op = 'select' } = raw;
  const def = TABLES[table];
  if (!def) return fail(`table_not_allowed:${table}`);
  if (!def.ops.includes(op)) return fail(`op_not_allowed:${table}.${op}`);

  const spec = { table, op, filters: [], order: [] };

  if (raw.select != null) {
    if (typeof raw.select !== 'string' || raw.select.length > 500) return fail('bad_select');
    spec.select = raw.select;
  }
  if (raw.selectOpts) {
    const { count, head } = raw.selectOpts;
    if (count && !['exact', 'planned', 'estimated'].includes(count)) return fail('bad_count');
    spec.selectOpts = { ...(count ? { count } : {}), ...(head ? { head: true } : {}) };
  }

  for (const f of raw.filters || []) {
    if (!f || !FILTER_METHODS.has(f.m) || !Array.isArray(f.a)) return fail('bad_filter');
    if (f.m === 'or') {
      if (typeof f.a[0] !== 'string' || f.a[0].length > 1000) return fail('bad_or');
    } else if (typeof f.a[0] !== 'string' || !COLUMN.test(f.a[0])) {
      return fail('bad_filter_column');
    }
    if (f.m === 'in' && !Array.isArray(f.a[1])) return fail('bad_in');
    spec.filters.push({ m: f.m, a: f.a.slice(0, 3) });
  }

  for (const o of raw.order || []) {
    if (!o || typeof o.col !== 'string' || !COLUMN.test(o.col)) return fail('bad_order');
    spec.order.push({ col: o.col, opts: { ascending: o.opts?.ascending !== false, ...(o.opts?.nullsFirst != null ? { nullsFirst: !!o.opts.nullsFirst } : {}) } });
  }

  if (raw.range) {
    const [from, to] = raw.range.map(Number);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return fail('bad_range');
    spec.range = [from, Math.min(to, from + MAX_ROWS - 1)];
  }
  if (raw.limit != null) {
    const n = Number(raw.limit);
    if (!Number.isInteger(n) || n < 1) return fail('bad_limit');
    spec.limit = Math.min(n, MAX_ROWS);
  }
  if (raw.single && !['single', 'maybe'].includes(raw.single)) return fail('bad_single');
  if (raw.single) spec.single = raw.single;

  if (op === 'insert' || op === 'update') {
    const rows = Array.isArray(raw.values) ? raw.values : [raw.values];
    if (!rows.length || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) return fail('bad_values');
    if (op === 'update' && Array.isArray(raw.values)) return fail('bad_values');
    const cleaned = rows.map(r => cleanValues(table, op, r));
    if (cleaned.some(c => c === null)) return fail('column_not_updatable');
    spec.values = Array.isArray(raw.values) ? cleaned : cleaned[0];
  }

  // update/delete with no filter would hit every row of the business; refuse.
  if ((op === 'update' || op === 'delete') && !spec.filters.some(f => f.m === 'eq' || f.m === 'in')) {
    return fail('update_needs_filter');
  }

  return { ok: true, spec };
}

/** Strip scope and identity columns; for businesses, allow only BUSINESS_UPDATABLE. */
function cleanValues(table, op, row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!COLUMN.test(k) || k.includes('.')) return null;
    if (k === 'business_id' || (k === 'id' && op === 'update')) continue;
    if (table === 'businesses' && !BUSINESS_UPDATABLE.has(k)) return null;
    if (SECRET_KEY.test(k)) return null;
    out[k] = v;
  }
  return out;
}

/** Force every inserted row onto the owner's business. */
export function scopeInsertValues(values, businessId) {
  return Array.isArray(values)
    ? values.map(v => ({ ...v, business_id: businessId }))
    : { ...values, business_id: businessId };
}

/** Remove secret-looking keys at any depth before data leaves the server. */
export function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out;
  }
  return value;
}
