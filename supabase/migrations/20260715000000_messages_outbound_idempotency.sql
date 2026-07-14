-- Outbound n8n/automation message idempotency and payload audit fields.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS raw_payload JSONB;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text',
    'image',
    'document',
    'audio',
    'video',
    'location',
    'template',
    'interactive'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_org_idempotency_key
  ON messages(organization_id, idempotency_key)
  WHERE organization_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_source
  ON messages(organization_id, source, created_at DESC)
  WHERE source IS NOT NULL;
