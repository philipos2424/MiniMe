-- 040_order_task_link.sql — Link delegated tasks back to the order that spawned them
--
-- createOrderDelegationTasks() already fans an order out into one agent_tasks
-- row per job needed (prep, delivery, ...) and routes each to the right team
-- member — but nothing ever recorded which order a task came from, so the
-- owner has no single "Order #123: 2/2 done" view, just separate task rows
-- that happen to mention the same order number in their titles. This adds
-- the missing link; `orders` already has a real id, so no new table.

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_order_id ON agent_tasks(order_id) WHERE order_id IS NOT NULL;
