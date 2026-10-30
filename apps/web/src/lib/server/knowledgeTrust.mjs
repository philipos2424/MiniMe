/**
 * Knowledge trust — what the owner taught outranks what MiniMe picked up.
 *
 * documents.meta.source tells us where a knowledge entry came from:
 *   'teaching', 'owner-correction', or no source (an owner upload) → the owner
 *   'auto-learn' → extracted by autoLearn.js from past chats, never reviewed
 *
 * For iconnect on 28 Oct 2026, 1,745 of ~1,840 entries were auto-learned. One
 * of them ("You can visit https://jami.bio/ to check out minime agent …
 * (why: Provides official link …)") is how a customer was told MiniMe is "the
 * AI agent that runs iConnect" and sent to a link the owner doesn't use.
 */
export const OWNER_SOURCES = new Set(['teaching', 'owner-correction', 'owner', 'upload', 'faq']);

export function isOwnerAuthoredSource(source) {
  return !source || OWNER_SOURCES.has(source);
}

/** Drop autoLearn's "(why: …)" rationale — it reads like an endorsement to the model. */
export function cleanChunkContent(content) {
  return String(content || '').replace(/\n?\(why:[^)]*\)\s*$/i, '').trim();
}

/**
 * Attach source + trust to chunks, owner-authored first (then by similarity),
 * keeping at most `count`.
 */
export function rankChunks(chunks, sourceByDocId, count = 4) {
  return (chunks || [])
    .map(c => {
      const source = sourceByDocId?.[c.document_id] ?? null;
      return { ...c, source, ownerAuthored: isOwnerAuthoredSource(source), content: cleanChunkContent(c.content) };
    })
    .sort((a, b) => (Number(b.ownerAuthored) - Number(a.ownerAuthored)) || ((b.similarity || 0) - (a.similarity || 0)))
    .slice(0, count);
}

/** Prompt line for one chunk: learned entries are labelled as lower trust. */
export function chunkPromptLine(c, i) {
  const tag = c.ownerAuthored ? `KB-${i + 1}` : `LEARNED-${i + 1} · picked up from a past chat, not confirmed by the owner`;
  return `[${tag}] ${String(c.content || '').slice(0, 900)}`;
}
