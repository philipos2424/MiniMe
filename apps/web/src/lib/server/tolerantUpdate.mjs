/**
 * Writing a businesses row that mentions columns this database doesn't have yet.
 *
 * Migrations here are applied by hand in the Supabase SQL editor, so there is
 * always a window where deployed code knows about a column the database does
 * not. Supabase fails the WHOLE update in that case — so an update that records
 * a real payment AND sets a lifecycle nicety loses both, leaving a merchant who
 * just paid with no proof recorded and no review queued.
 *
 * The fix is to rank the payload: columns that arrive by migration are dropped
 * on demand, everything else is essential and its failure must surface.
 *
 * This lived inline in api/payment/subscribe/proof/route.js and hardcoded a
 * single column name (payment_submitted_at). When payment_state became the
 * newly-added column, the hardcoded retry no longer matched and every proof
 * upload threw instead of degrading. Driving it off the column named in the
 * error removes that failure mode for the next migration too.
 */

/** Columns that arrive by hand-run migration, newest first. */
export const MIGRATION_GATED_COLUMNS = ['payment_state', 'payment_submitted_at'];

/**
 * @param {{ from: (t: string) => any }} sb        Supabase client
 * @param {string} businessId
 * @param {Record<string, unknown>} updates
 * @param {{ gated?: string[], label?: string }} [opts]
 */
export async function updateBusinessTolerantly(sb, businessId, updates, opts = {}) {
  const gated = opts.gated || MIGRATION_GATED_COLUMNS;
  const label = opts.label || 'tolerant-update';
  let payload = { ...updates };
  const dropped = [];

  // At most one attempt per gated column, plus the initial one.
  for (let attempt = 0; attempt <= gated.length; attempt++) {
    const { error } = await sb.from('businesses').update(payload).eq('id', businessId);
    if (!error) {
      if (dropped.length) {
        console.warn(`[${label}] wrote without ${dropped.join(', ')} — migration(s) not applied yet`);
      }
      return { dropped };
    }

    // Which gated column is this error about? PostgREST names the unknown
    // column in the message ("Could not find the 'x' column of 'businesses'").
    const missing = gated.find(col => col in payload && error.message?.includes(col));
    if (!missing) throw new Error(error.message);

    console.warn(`[${label}] ${missing} unavailable, retrying without it:`, error.message);
    const { [missing]: _omit, ...rest } = payload;
    payload = rest;
    dropped.push(missing);
  }

  throw new Error(`[${label}] update failed after dropping every optional column`);
}
