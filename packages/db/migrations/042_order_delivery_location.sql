-- ============================================================
-- 042: Delivery location capture
-- Customer-shared Telegram location for delivery, captured via a
-- request_location reply-keyboard at checkout (message.location in
-- replyEngine.js's tenant message dispatch).
--
-- NOTE: post-fulfillment CSAT is intentionally NOT added here — it's
-- already covered twice over (customer_memory 'feedback' rows from the
-- fb_<orderId>_<rating> callback, and the feedback table + orders.meta.
-- feedback_rating from fb_rate_<orderId>_<rating>). A third mechanism
-- would just double-prompt customers.
-- ============================================================

alter table orders
  add column if not exists delivery_lat numeric(9,6),
  add column if not exists delivery_lng numeric(9,6);
