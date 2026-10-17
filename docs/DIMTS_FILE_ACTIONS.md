# Reviewed Dimts file actions

Additive signed endpoint: `POST /api/dimts/files`. The existing text-send
endpoint and original link remain compatible. Requests use the established
Standard Webhooks signature and `DIMTS_LINK_SECRET`.

Operations:

- `options`: user ID and caller phone return eligible business documents and
  exact international-phone matches with a Telegram chat.
- `prepare`: select document/customer IDs and caption. Returns file metadata,
  recipient details, an approval digest and a 60-second preview URL; sends nothing.
- `send`: execution UUID and approved selection. Revalidates the current file
  bytes and recipient, claims an idempotency record, sends once and saves the
  Telegram message ID.
- `status`: retrieves the linked business's persisted receipt by execution UUID.

Approval binds the actual bytes, filename, customer/chat, business, owner,
phone and caption. Changed selections require review. A reused execution ID
with changed input is rejected. The ledger stores IDs, status and hashes,
not file content or captions. RLS prevents anonymous/authenticated Data API access.

Send limits: enabled/ready stored files, maximum 20 MiB, existing Telegram
customer with exact phone match, business bot identity only. Options list the
latest 100 eligible documents. No WhatsApp execution or cold messages.

A timeout or missing receipt is unknown; it must not trigger a new send.
An accepted Telegram send whose receipt could not be persisted requires manual
investigation. The implementation does not claim exactly-once delivery across
provider crashes. Status means accepted/sent by Telegram, not read/delivered.

## Deployment

Apply `packages/db/migrations/20261013_dimts_files.sql` after the original link
migration, deploy MiniMe, then release the paired Dimts changes/migrations.
Use the existing shared secret. Dimts opts in with `MINIME_FILE_ACTIONS=1`,
which switches off its legacy automatic promise dispatch while review mode is on.
Do not use the `send` operation for a smoke test without an explicitly approved
recipient/file. No real messages were sent while developing these changes.

## Validation

All 414 tests pass, including the file-action and signed-link tests. This branch
includes the existing learning reliability repair `396c11d`, which fixes the
three baseline onboarding failures involving teaching chunk writes, catalog
currencies and FAQ persistence. The repair's regression tests are included.

The existing test imported PGlite without declaring it. This change declares
the exact development dependency so CI can execute that test rather than fail
at module loading. No failing tests are skipped or suppressed.

The Next.js production build passes using CI placeholder configuration, with
warnings from existing dependencies and a network-blocked optional font download.

Read-only production metadata confirms the original `dimts_links` table and
the required document/customer columns exist. The new file-delivery migration
has not been applied. A real Telegram acceptance test remains required.
