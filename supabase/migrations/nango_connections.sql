-- Nango-managed Meta connections (one connection per platform per business).
-- Legacy columns (facebook_page_id, instagram_page_id, whatsapp_phone_number_id,
-- meta_access_token_enc) are kept: page/phone IDs still route inbound webhooks,
-- and the encrypted token remains the send fallback for pre-Nango businesses.
alter table businesses add column if not exists nango_connection_id_facebook text;
alter table businesses add column if not exists nango_connection_id_instagram text;
alter table businesses add column if not exists nango_connection_id_whatsapp text;

-- Backfilled messages are historical imports: excluded from auto-reply and counted separately.
alter table messages add column if not exists backfilled boolean default false;
