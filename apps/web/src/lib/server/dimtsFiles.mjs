import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(value).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function fileError(code, status = 409) { return Object.assign(new Error(code), { code, status }); }
const text = (v, max) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw fileError('invalid_request', 400);
  return v.trim();
};
export function parseFileRequest(input) {
  if (!input || !['options', 'prepare', 'send', 'status'].includes(input.operation)) throw fileError('invalid_request', 400);
  const req = { operation: input.operation, user_id: text(input.user_id, 100) };
  if (req.operation === 'status' || req.operation === 'send') {
    req.send_id = text(input.send_id, 36);
    if (!UUID.test(req.send_id)) throw fileError('invalid_request', 400);
  }
  if (req.operation === 'status') return req;
  req.phone = text(input.phone, 16);
  if (!/^\+[1-9]\d{7,14}$/.test(req.phone)) throw fileError('invalid_request', 400);
  if (req.operation === 'options') return req;
  req.document_id = text(input.document_id, 36);
  req.customer_id = text(input.customer_id, 36);
  if (!UUID.test(req.document_id) || !UUID.test(req.customer_id)) throw fileError('invalid_request', 400);
  req.caption = typeof input.caption === 'string' ? input.caption.trim() : '';
  if (req.caption.length > 1000) throw fileError('invalid_request', 400);
  if (req.operation === 'send') {
    req.approval_hash = text(input.approval_hash, 64);
    if (!/^[a-f0-9]{64}$/.test(req.approval_hash)) throw fileError('invalid_request', 400);
  }
  return req;
}

// Deliberately no national-number guessing in a file-sharing flow.
export const exactPhone = (stored, expected) => typeof stored === 'string' &&
  stored.replace(/[\s()+.-]/g, '') === expected.slice(1);

export const publicReceipt = row => ({
  status: row.status,
  message_id: row.status === 'sent' ? row.message_id : null,
  error: row.error || null,
});

/** Dependency-injected orchestration; real adapters live in dimtsFilesAdapter.js. */
export function createFileService(io) {
  async function context(req) {
    const business = await io.business(req.user_id);
    if (!business) throw fileError('not_linked');
    return business;
  }
  async function selection(business, req) {
    const customer = await io.customer(business.id, req.customer_id);
    if (!customer?.telegram_id || !exactPhone(customer.phone, req.phone)) throw fileError('recipient_changed');
    const document = await io.document(business.id, req.document_id);
    if (!document?.enabled || document.status !== 'ready' || !document.storage_path) throw fileError('file_unavailable');
    const bytes = await io.download(document.storage_path);
    if (!bytes?.length || bytes.length > 20 * 1024 * 1024) throw fileError('file_size_unsupported');
    const filename = document.original_filename || document.title || 'document';
    // The reviewed digest binds the bytes, destination, caption and linked business.
    const approval_hash = digest(JSON.stringify([business.id, req.user_id, req.phone, customer.id,
      String(customer.telegram_id), document.id, filename, digest(bytes), req.caption]));
    return { customer, document, bytes, filename, approval_hash };
  }
  return async function handle(input) {
    const req = parseFileRequest(input);
    const business = await context(req);
    if (req.operation === 'options') {
      const customers = (await io.customers(business.id, req.phone)).filter(c => c.telegram_id && exactPhone(c.phone, req.phone));
      const documents = await io.documents(business.id);
      return {
        channel: 'telegram',
        recipients: customers.map(c => ({ id: c.id, name: c.name || req.phone, phone: req.phone })),
        files: documents.map(d => ({ id: d.id, name: d.original_filename || d.title || 'document' })),
      };
    }
    if (req.operation === 'status') {
      const row = await io.prior(business.id, req.send_id);
      return row ? publicReceipt(row) : { status: 'not_found', message_id: null, error: null };
    }
    const requestHash = req.operation === 'send' ? digest(JSON.stringify(req)) : null;
    if (req.operation === 'send') {
      const prior = await io.prior(business.id, req.send_id);
      if (prior) {
        if (prior.request_hash !== requestHash) throw fileError('execution_changed');
        return publicReceipt(prior);
      }
    }
    const selected = await selection(business, req);
    if (req.operation === 'prepare') return {
      approval_hash: selected.approval_hash,
      recipient: { id: selected.customer.id, name: selected.customer.name || req.phone, phone: req.phone },
      file: { id: selected.document.id, name: selected.filename, bytes: selected.bytes.length },
      caption: req.caption,
      preview_url: await io.preview(selected.document.storage_path),
    };
    if (selected.approval_hash !== req.approval_hash) throw fileError('selection_changed');
    // Recheck link after downloading. Neither file bytes nor message text enter the ledger.
    const stillLinked = await context(req);
    if (stillLinked.id !== business.id) throw fileError('not_linked');
    const claimed = await io.claim({ business_id: business.id, send_id: req.send_id, request_hash: requestHash, status: 'sending' });
    if (!claimed) {
      const prior = await io.prior(business.id, req.send_id);
      if (!prior || prior.request_hash !== requestHash) throw fileError('execution_changed');
      return publicReceipt(prior);
    }
    let outcome;
    try {
      // One transport attempt. Never fall back to a second sender after an uncertain result.
      const result = await io.send(business, selected.customer.telegram_id, selected.bytes, selected.filename, req.caption);
      const messageId = result?.result?.message_id;
      if (result?.ok === true && Number.isSafeInteger(messageId) && messageId > 0) {
        outcome = { status: 'sent', message_id: messageId, error: null };
      } else if (result?.ok === false) {
        outcome = { status: 'failed', message_id: null, error: 'telegram_rejected' };
      } else outcome = { status: 'unknown', message_id: null, error: 'receipt_missing' };
    } catch {
      outcome = { status: 'unknown', message_id: null, error: 'transport_uncertain' };
    }
    await io.finish(business.id, req.send_id, outcome);
    return outcome;
  };
}
