/**
 * Shared reply helpers — imported by both replyEngine (Telegram) and
 * metaReplyEngine (WhatsApp/Instagram/Facebook).
 *
 * These are just re-exports so callers have a stable import path.
 */
export { draftReply, shouldAutoSend } from './replyEngine';
