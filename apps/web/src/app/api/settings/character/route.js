/**
 * GET  /api/settings/character  — list recent conversations for soul-learning picker
 * POST /api/settings/character  — auto-detect personality (optionally from chosen convos)
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, update as updateBusiness } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { loggedCompletion } from '../../../../lib/server/openai-wrapper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ─── helpers ─── */

function authBusiness(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  return parseTelegramUser(initData);
}

/* ─── GET: list conversations for the picker ─── */

export async function GET(request) {
  const tg = authBusiness(request);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const business = await findByOwnerTelegramId(tg.id);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();

  // Fetch recent conversations with customer name + message counts
  const { data: convos } = await sb
    .from('conversations')
    .select('id, customer_id, message_count, last_message_at, status')
    .eq('business_id', business.id)
    .order('last_message_at', { ascending: false })
    .limit(30);

  if (!convos?.length) {
    return NextResponse.json({ conversations: [] });
  }

  // Get customer names in one query
  const customerIds = [...new Set(convos.map(c => c.customer_id))];
  const { data: customers } = await sb
    .from('customers')
    .select('id, name, telegram_username')
    .in('id', customerIds);

  const customerMap = {};
  (customers || []).forEach(c => { customerMap[c.id] = c; });

  // For each conversation, get a preview (last outbound message from owner)
  const convoIds = convos.map(c => c.id);
  const { data: previews } = await sb
    .from('messages')
    .select('conversation_id, content')
    .in('conversation_id', convoIds)
    .eq('direction', 'outbound')
    .or('is_ai_generated.is.null,is_ai_generated.eq.false,owner_edited.eq.true')
    .order('created_at', { ascending: false })
    .limit(60);

  // Group previews by conversation — take only the first (most recent) per convo
  const previewMap = {};
  (previews || []).forEach(m => {
    if (!previewMap[m.conversation_id] && m.content?.length > 3) {
      previewMap[m.conversation_id] = m.content.slice(0, 80);
    }
  });

  // Count owner messages per conversation (to show which ones have good data)
  const { data: ownerCounts } = await sb
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', convoIds)
    .eq('direction', 'outbound')
    .or('is_ai_generated.is.null,is_ai_generated.eq.false,owner_edited.eq.true');

  const ownerMsgCount = {};
  (ownerCounts || []).forEach(m => {
    ownerMsgCount[m.conversation_id] = (ownerMsgCount[m.conversation_id] || 0) + 1;
  });

  const result = convos
    .filter(c => (ownerMsgCount[c.id] || 0) >= 1) // only show convos where owner actually replied
    .map(c => {
      const cust = customerMap[c.customer_id] || {};
      return {
        id: c.id,
        customerName: cust.name || cust.telegram_username || 'Unknown',
        messageCount: c.message_count || 0,
        ownerMessages: ownerMsgCount[c.id] || 0,
        lastActive: c.last_message_at,
        preview: previewMap[c.id] || null,
        status: c.status,
      };
    })
    .slice(0, 20);

  // Also flag which convos were used last time (if stored)
  const lastUsed = business.voice_embedding?.character?.source_conversations || [];

  return NextResponse.json({ conversations: result, lastUsed });
}

/* ─── POST: auto-detect personality ─── */

export async function POST(request) {
  const tg = authBusiness(request);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const business = await findByOwnerTelegramId(tg.id);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();

  // Check if specific conversation IDs were sent
  let selectedConvoIds = null;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.conversationIds?.length) {
      selectedConvoIds = body.conversationIds;
    }
  } catch { /* no body = use all */ }

  let convoIds;

  if (selectedConvoIds?.length) {
    // Verify these conversations belong to this business
    const { data: verified } = await sb
      .from('conversations')
      .select('id')
      .eq('business_id', business.id)
      .in('id', selectedConvoIds);
    convoIds = (verified || []).map(c => c.id);
    if (!convoIds.length) {
      return NextResponse.json({ error: 'invalid', message: 'None of those conversations belong to your business.' }, { status: 400 });
    }
  } else {
    // Fallback: use all recent conversations
    const { data: convos } = await sb
      .from('conversations')
      .select('id')
      .eq('business_id', business.id)
      .order('last_message_at', { ascending: false })
      .limit(20);
    if (!convos?.length) {
      return NextResponse.json({ error: 'not_enough_data', message: 'No conversations yet — chat with a few customers first.' }, { status: 400 });
    }
    convoIds = convos.map(c => c.id);
  }

  // Fetch owner's REAL outbound messages from selected conversations
  const { data: msgs } = await sb.from('messages')
    .select('content')
    .in('conversation_id', convoIds)
    .eq('direction', 'outbound')
    .or('is_ai_generated.is.null,is_ai_generated.eq.false,owner_edited.eq.true')
    .order('created_at', { ascending: false })
    .limit(40);

  const realMsgs = (msgs || [])
    .filter(m => m.content && m.content.length > 3 && m.content.length < 500)
    .map(m => m.content);

  // Also include sample replies the owner manually added
  const samples = business.sample_replies || [];
  const allMessages = [...realMsgs, ...samples].slice(0, 30);

  if (allMessages.length < 3) {
    return NextResponse.json({
      error: 'not_enough_data',
      message: selectedConvoIds
        ? 'Those conversations don\'t have enough of your own replies. Pick ones where you typed more, or add more conversations.'
        : 'Need at least 3 messages to detect personality. Keep chatting!',
    }, { status: 400 });
  }

  // Ask GPT to analyze the owner's texting personality
  const ownerName = business.owner_name?.split(' ')[0] || 'the owner';
  const res = await loggedCompletion({
    route: 'auto_character',
    business_id: business.id,
    model: 'gpt-4o-mini',
    temperature: 0.5,
    max_tokens: 600,
    messages: [
      { role: 'system', content: `You are a personality analyst. Given a set of real Telegram messages written by a business owner named ${ownerName}, analyze their texting style and personality.

Return a JSON object with these fields:
- "traits": array of 2-4 traits from this list ONLY: funny, warm, direct, patient, playful, focused, humble, confident, storyteller, caring
- "energy": one of: chill, energetic, balanced
- "values": array of 1-3 values from this list ONLY: quality, relationships, speed, honesty, creativity, value
- "description": a 1-2 sentence first-person description of how they communicate (write as if ${ownerName} is describing themselves, casual tone, max 200 chars)

Pick traits based on EVIDENCE in the messages — don't guess. If they use humor → funny. If they're brief → direct. If they use warmth words → warm. If they're patient with questions → patient.

Return ONLY valid JSON, no markdown, no explanation.` },
      { role: 'user', content: `Here are ${allMessages.length} real messages from ${ownerName}:\n\n${allMessages.map((m, i) => `${i + 1}. "${m}"`).join('\n')}` },
    ],
  });

  let character;
  try {
    const raw = res.choices[0]?.message?.content?.trim() || '{}';
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    character = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: 'parse_error', message: 'Could not analyze — try again.' }, { status: 500 });
  }

  // Validate and sanitize
  const VALID_TRAITS = ['funny', 'warm', 'direct', 'patient', 'playful', 'focused', 'humble', 'confident', 'storyteller', 'caring'];
  const VALID_ENERGIES = ['chill', 'energetic', 'balanced'];
  const VALID_VALUES = ['quality', 'relationships', 'speed', 'honesty', 'creativity', 'value'];

  const safe = {
    traits: (character.traits || []).filter(t => VALID_TRAITS.includes(t)).slice(0, 4),
    energy: VALID_ENERGIES.includes(character.energy) ? character.energy : 'balanced',
    values: (character.values || []).filter(v => VALID_VALUES.includes(v)).slice(0, 3),
    description: (character.description || '').slice(0, 500),
    backstory: '', // owner fills this in themselves
    source_conversations: convoIds, // remember which convos were used
    detected_at: new Date().toISOString(),
  };

  // Save to voice_embedding.character
  const voiceEmbed = { ...(business.voice_embedding || {}), character: safe };
  await updateBusiness(business.id, { voice_embedding: voiceEmbed });

  return NextResponse.json({ ok: true, character: safe, messagesAnalyzed: allMessages.length });
}
