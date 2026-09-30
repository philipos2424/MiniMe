import crypto from 'node:crypto';
import { supabase } from './db';

const PREVIEW_TTL_MS = 10 * 60 * 1000;

// Owner-bound tokens survive cold starts and separate preview/edit workers.
// These records never enter live conversations, messages, or customer context.
export async function storePreviewSession(tgId, payload) {
  const token = crypto.randomUUID();
  const sb = supabase();
  const { error } = await sb.from('onboarding_reply_previews').insert({
    id: token, business_id: payload.business_id, owner_telegram_id: tgId,
    question: payload.question, draft: payload.draft,
    expires_at: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
  });
  if (error) throw new Error('Could not save the private preview. Please try again.');
  // Expired tokens are inaccessible immediately; prune their payloads as well.
  await sb.from('onboarding_reply_previews').delete().lt('expires_at', new Date().toISOString());
  return token;
}

export async function getPreviewSession(token, tgId) {
  const { data, error } = await supabase().from('onboarding_reply_previews')
    .select('business_id,question,draft')
    .eq('id', token).eq('owner_telegram_id', tgId)
    .gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error) throw new Error('Could not load the private preview. Please retry.');
  return data || null;
}
