-- Separate conversation-level automation control.
-- 'agent' => built-in automations / n8n webhooks may run
-- 'human' => inbound messages are saved, but automation dispatch is skipped

ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS automation_mode TEXT NOT NULL DEFAULT 'agent';

ALTER TABLE conversations
DROP CONSTRAINT IF EXISTS conversations_automation_mode_check;

ALTER TABLE conversations
ADD CONSTRAINT conversations_automation_mode_check
CHECK (automation_mode IN ('agent', 'human'));

CREATE INDEX IF NOT EXISTS idx_conversations_automation_mode
ON conversations(user_id, automation_mode);

