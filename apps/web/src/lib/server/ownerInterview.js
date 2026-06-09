/**
 * ownerInterview.js
 *
 * MiniMe interviews the business owner. Instead of expecting the owner to know
 * WHAT to teach (the #1 reason catalogs stay empty), MiniMe asks short, plain
 * questions one at a time and feeds every answer through the teaching pipeline —
 * which embeds the knowledge AND creates real catalog products.
 *
 * State lives in `businesses.notification_prefs.interview` (same place reminders
 * and owner_chat live), so it survives across messages with no new table:
 *   { status: 'active', step: N, answers: [{ q, a }], products: M, started_at }
 *
 * Flow: owner sends /learn  → startOwnerInterview() asks Q1.
 *       owner replies        → handleInterviewReply() teaches the answer, asks next.
 *       last answer          → finish: summary + total products added.
 * The owner can type "skip" (skip one), or "stop"/"done"/"cancel" (end early).
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { teachFromText } from './teaching';

// Short, plain-language questions. Ordered so the catalog-seeding question (Q2)
// comes early — that's the one that actually fills the price list. Each answer
// is taught with its question as context, so the KB keeps the Q&A framing.
export const INTERVIEW_QUESTIONS = [
  {
    key: 'what',
    q: 'In one line — what does your business sell or do?',
  },
  {
    key: 'catalog',
    q: 'List your main items or services with prices — one per line. I\'ll turn these into your price list.\n\nExample:\nLeather bag — 2500 birr\nWallet — 800 birr',
  },
  {
    key: 'different',
    q: 'Why do customers choose you over others? What makes you different?',
  },
  {
    key: 'delivery',
    q: 'How do customers get it? Tell me about delivery / pickup, areas you cover, and how they pay (telebirr, CBE, cash…).',
  },
  {
    key: 'faq',
    q: 'Last one — what do customers ask you most? (hours, sizes, warranty, anything.)',
  },
];

const STOP_RE = /^\s*(stop|done|cancel|finish|exit|quit|አቁም|በቃ)\s*$/i;
const SKIP_RE = /^\s*(skip|pass|next|none|n\/a|na| የለም|ዝለል)\s*$/i;

// The Telegram webhook awaits the whole handler on a hard 60s ceiling (and the
// update is already deduped, so a timeout is NEVER retried). So nothing in the
// interview may run unbounded: a single hung OpenAI call would freeze the bot
// ("stuck after /learn") and, if it dies before state is persisted, wedge the
// interview in 'active' so it keeps swallowing the owner's later messages.
const TEACH_TIMEOUT_MS = 35_000;   // per-answer learning
const PREVIEW_TIMEOUT_MS = 15_000; // the optional "here's a taste" demo
const STALE_INTERVIEW_MS = 45 * 60 * 1000; // auto-expire a wedged interview

/** Resolve to a sentinel instead of hanging forever. Never rejects. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    Promise.resolve(promise).catch((e) => {
      console.warn(`[ownerInterview] ${label} error:`, e?.message);
      return undefined;
    }),
    new Promise((resolve) => setTimeout(() => {
      console.warn(`[ownerInterview] ${label} timed out after ${ms}ms`);
      resolve(undefined);
    }, ms)),
  ]);
}

export function getInterviewState(business) {
  return business?.notification_prefs?.interview || null;
}

async function saveInterviewState(business, state) {
  const prefs = { ...(business.notification_prefs || {}), interview: state };
  try {
    await supabase().from('businesses').update({ notification_prefs: prefs }).eq('id', business.id);
    business.notification_prefs = prefs; // keep local copy in sync
  } catch (e) {
    console.warn('[ownerInterview] save state:', e.message);
  }
}

async function clearInterviewState(business) {
  await saveInterviewState(business, { status: 'idle' });
}

/** A slash command (e.g. /orders) interrupted the interview — keep the place so
 *  /learn resumes instead of restarting from Q1. */
export async function pauseInterview(business) {
  const state = getInterviewState(business);
  if (state?.status === 'active') await saveInterviewState(business, { ...state, status: 'paused' });
}

function progressTag(step) {
  return `_Question ${step + 1} of ${INTERVIEW_QUESTIONS.length}_`;
}

/** Owner sent /learn — start fresh, or resume if they were interrupted. */
export async function startOwnerInterview(token, business, chatId) {
  const prev = getInterviewState(business);

  // Resume a paused interview from where we left off — don't re-ask answered Qs.
  if (prev?.status === 'paused' && Number.isInteger(prev.step) && prev.step < INTERVIEW_QUESTIONS.length) {
    await saveInterviewState(business, { ...prev, status: 'active' });
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: `🪞 *Picking up where we left off.*\n\n${progressTag(prev.step)}\n\n${INTERVIEW_QUESTIONS[prev.step].q}`,
      parse_mode: 'Markdown',
    });
    return true;
  }

  await saveInterviewState(business, {
    status: 'active', step: 0, answers: [], products: 0, started_at: Date.now(),
  });
  await tg(token, 'sendMessage', {
    chat_id: chatId,
    text: `🪞 *Let's set up MiniMe together.*\n\nI'll ask a few quick questions about your business and learn from your answers — so I can reply to customers accurately, in your voice.\n\nAnswer in your own words. Type *skip* to skip one, or *stop* anytime.\n\n${progressTag(0)}\n\n${INTERVIEW_QUESTIONS[0].q}`,
    parse_mode: 'Markdown',
  });
  return true;
}

/**
 * Owner replied while an interview is active. Teach the answer, advance, ask the
 * next question (or finish). Returns true if it consumed the message.
 * `answerText` should already be plain text (transcribe voice before calling).
 */
export async function handleInterviewReply(token, business, chatId, answerText) {
  const state = getInterviewState(business);
  if (!state || state.status !== 'active') return false;

  // Safety valve: if an interview somehow wedged 'active' (e.g. a prior answer's
  // teach call was killed by the 60s webhook ceiling before state advanced),
  // don't swallow the owner's messages forever. Expire it and let this message
  // flow through to the normal handler.
  if (state.started_at && (Date.now() - state.started_at) > STALE_INTERVIEW_MS) {
    console.warn('[ownerInterview] stale active interview — clearing, passing message through');
    await clearInterviewState(business);
    return false;
  }

  const text = (answerText || '').trim();

  // End early — keep whatever we already learned.
  if (STOP_RE.test(text)) {
    await clearInterviewState(business);
    const got = state.products || 0;
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: `👍 Stopped — I kept everything you told me so far${got ? ` (${got} product${got === 1 ? '' : 's'} added)` : ''}.\n\nSend */learn* anytime to pick up where we left off.`,
      parse_mode: 'Markdown',
    });
    return true;
  }

  const step = state.step || 0;
  const question = INTERVIEW_QUESTIONS[step];
  const answers = Array.isArray(state.answers) ? state.answers : [];
  let products = state.products || 0;

  // Teach the answer (unless they skipped). Frame it with the question so the
  // knowledge base keeps context, and so the catalog extractor sees price lines.
  if (question && !SKIP_RE.test(text) && text.length > 1) {
    // Frame the answer with the question for KB context — but STRIP the "Example:"
    // block first. The catalog question shows sample lines ("Leather bag — 2500
    // birr") to guide the owner; if we fed those into the teaching pipeline they'd
    // be embedded as the business's own knowledge AND mistaken for real catalog
    // items by the product extractor. We only ever want to learn the owner's
    // actual answer, never our own prompt's placeholder.
    const promptContext = question.q.split(/\n\s*Example:/i)[0].trim();
    // Time-boxed: a hung teach must not eat the 60s webhook budget. If it times
    // out we still advance the interview below, so the owner is never stuck —
    // they can always re-teach this answer later.
    const r = await withTimeout(
      teachFromText(business.id, `${promptContext}\n${text}`),
      TEACH_TIMEOUT_MS,
      'teach',
    );
    products += (r?.products_added || 0);
    answers.push({ q: question.key, a: text.slice(0, 500) });
  }

  const nextStep = step + 1;

  // More questions to go.
  if (nextStep < INTERVIEW_QUESTIONS.length) {
    await saveInterviewState(business, { ...state, step: nextStep, answers, products });
    const gained = products - (state.products || 0);
    // Don't promise a price list we didn't build. If this was the catalog step
    // and the owner clearly typed prices (a digit is present) but nothing parsed,
    // say so plainly and show the format — instead of a hollow "✅ Got it" that
    // hides the miss (the "I added my prices but the catalog is empty" gap).
    const looksPriced = /\d/.test(text) && !SKIP_RE.test(text);
    let ack;
    if (SKIP_RE.test(text)) {
      ack = '⏭️ Skipped.';
    } else if (gained > 0) {
      ack = `✅ Got it — *${gained} product${gained === 1 ? '' : 's'}* added to your price list.`;
    } else if (question?.key === 'catalog' && looksPriced) {
      ack = `✅ Got it — saved. _(I couldn't auto-read those as price-list items. You can add them anytime in this format: *Item name — 2500 birr*, one per line.)_`;
    } else {
      ack = '✅ Got it.';
    }
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: `${ack}\n\n${progressTag(nextStep)}\n\n${INTERVIEW_QUESTIONS[nextStep].q}`,
      parse_mode: 'Markdown',
    });
    return true;
  }

  // Finished the last question.
  await clearInterviewState(business);
  const lines = [`🎉 *All done — MiniMe just learned your business.*`];
  if (products > 0) lines.push(`\n📦 *${products} product${products === 1 ? '' : 's'}* are now in your catalog and ready to quote.`);
  lines.push(`\nYou can always teach more — send text, a photo of your price list, a PDF, or run */learn* again.`);
  await tg(token, 'sendMessage', { chat_id: chatId, text: lines.join('\n'), parse_mode: 'Markdown' });

  // Peak-curiosity moment: they just filled the catalog — don't ask them to type
  // anything, just SHOW it working. Auto-run one preview on a real catalog item
  // so the "whoa, it answered like me" payoff lands immediately. Best-effort.
  // The preview runs a full draftReply (the heaviest op in the system). State is
  // ALREADY cleared and the "All done" summary ALREADY sent above, so the demo is
  // pure upside — hard-bound it so a slow OpenAI call can't freeze the webhook.
  if (products > 0) {
    await withTimeout(
      autoPreviewFirstItem(token, business, chatId),
      PREVIEW_TIMEOUT_MS,
      'auto-preview',
    );
  }
  return true;
}

/**
 * Right after /learn fills the catalog, automatically demonstrate the assistant
 * answering a realistic customer question about a real item — so the owner FEELS
 * the payoff instead of being told to go type a command. Uses the exact customer
 * pipeline (draftReply, preview mode = no DB writes). Silent no-op on any failure.
 */
async function autoPreviewFirstItem(token, business, chatId) {
  // Grab the most recently added item to ask about.
  const { data: rows } = await supabase()
    .from('products')
    .select('name, price, currency')
    .eq('business_id', business.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1);
  const item = rows && rows[0];
  if (!item?.name) return;

  const question = `Hi, do you have ${item.name}? How much is it?`;

  // Reuse the real customer pipeline. Dynamic import avoids a circular dependency
  // (replyEngine imports this module). preview:true → no customer record written.
  const { draftReply } = await import('./replyEngine');
  const syntheticCustomer = { id: null, name: 'Customer' };
  const syntheticConversation = { id: null, metadata: {} };
  const { draft } = await draftReply(
    business, syntheticCustomer, syntheticConversation, question,
    { isSecretary: false, preview: true }
  );
  if (!draft) return;

  await tg(token, 'sendMessage', {
    chat_id: chatId,
    text: `👀 *Here's a taste.* A customer asks:\n\n💬 _"${question}"_\n\nYour MiniMe replies:\n\n${draft}\n\n— Want to test more? Send */preview your question* anytime.`,
    parse_mode: 'Markdown',
  });
}
