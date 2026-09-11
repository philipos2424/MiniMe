/**
 * Conversation inbox list — server side.
 *
 * This used to run in the browser against the anon Supabase client, which can
 * never work: 047_lock_down_anon_access.sql revoked every anon grant and left
 * RLS on with no policies, so PostgREST answered each read with a permission
 * error. ConversationsPage discarded that error and rendered its "No
 * conversations yet" empty state, so a full inbox looked like a new account.
 * Reads now run under the service role, scoped to the caller's business by the
 * route that owns the auth check.
 *
 * Kept free of any Supabase import so it can be unit-tested with a fake client.
 */

export const PAGE_SIZE = 30;

/**
 * Merge preview rows (one per conversation, from the conversation_previews
 * RPC) onto their conversations. Conversations with no preview row keep null
 * fields rather than disappearing.
 */
export function enrichConversations(convs, previews) {
  const byId = {};
  for (const p of previews || []) byId[p.conversation_id] = p;
  return (convs || []).map(c => {
    const p = byId[c.id];
    return {
      ...c,
      last_preview: p?.content || null,
      last_direction: p?.direction || null,
      last_channel: p?.channel || 'tg',
      // A Telegram upload can have an attachment with no stored URL yet, so
      // "has an attachment" is its own flag rather than being inferred from
      // the URL being present.
      last_has_file: !!p?.has_file,
      last_file_url: p?.file_url || null,
      last_file_type: p?.has_file ? (p.file_type || null) : null,
    };
  });
}

/** Tab counts for the inbox header. */
export function countBuckets(rows) {
  const list = rows || [];
  return {
    all: list.length,
    drafts: list.filter(c => c.requires_owner && c.last_ai_action === 'drafted').length,
    unread: list.filter(c => c.requires_owner).length,
  };
}

/**
 * One page of the inbox, enriched and scoped to a single business.
 *
 * @param sb  a Supabase client already holding service-role privileges
 * @returns { conversations, hasMore, counts }  counts is null for filtered or
 *          non-first pages, because a partial page cannot describe the inbox.
 */
export async function fetchConversationPage(sb, { businessId, filter = 'all', offset = 0, limit = PAGE_SIZE }) {
  let q = sb.from('conversations')
    .select('*, customers(*)')
    .eq('business_id', businessId)
    .order('last_message_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (filter === 'drafts') q = q.eq('requires_owner', true).eq('last_ai_action', 'drafted');
  if (filter === 'unread') q = q.eq('requires_owner', true);

  // The list itself is the point of the request — a failure here must surface,
  // not quietly become an empty inbox. That silent-empty behavior is the whole
  // reason this page looked broken.
  const { data: convs, error } = await q;
  // PostgREST hands back a plain object, not an Error — rethrow a real one so
  // the route's logs carry a stack and `.message` works for every caller.
  if (error) throw new Error(error.message || 'conversation list query failed', { cause: error });

  if (!convs?.length) {
    return {
      conversations: [],
      hasMore: false,
      counts: filter === 'all' && offset === 0 ? { all: 0, drafts: 0, unread: 0 } : null,
    };
  }

  const ids = convs.map(c => c.id);

  // Previews are best-effort: they decorate rows, so losing them must not cost
  // the user their inbox. This also lets the code deploy before
  // 052_conversation_previews.sql is applied — without the function the list
  // still renders, just without preview text.
  let previews = [];
  const { data: previewRows, error: previewError } = await sb.rpc('conversation_previews', {
    p_business_id: businessId,
    p_conversation_ids: ids,
  });
  if (previewError) {
    console.error('[conversationList] preview lookup failed, rendering without previews:', previewError);
  } else {
    previews = previewRows || [];
  }

  const conversations = enrichConversations(convs, previews);
  return {
    conversations,
    hasMore: convs.length === limit,
    counts: filter === 'all' && offset === 0 ? countBuckets(conversations) : null,
  };
}
