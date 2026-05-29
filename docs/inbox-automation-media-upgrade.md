# Inbox Automation + Media Upgrade

This document records the product and technical changes added to support:

1. Agent/Human automation control per conversation
2. n8n/AI replies that stay synced in the CRM inbox
3. Admin image send and media actions in Inbox

---

## 1) Conversation Automation Mode

### What changed

- Added `conversations.automation_mode` with values:
  - `agent` (default): automations and n8n webhooks can run
  - `human`: inbound messages are saved, but automation dispatch is skipped

### Migration

- File: `supabase/migrations/014_conversation_automation_mode.sql`
- Includes:
  - column add with default
  - check constraint for allowed values
  - index on `(user_id, automation_mode)`

### UI

- Inbox thread header now has a separate dropdown:
  - `Agent Mode`
  - `Human Mode`
- Existing conversation status (`Open/Pending/Closed`) remains unchanged.

### Runtime behavior

- Webhook (`/api/whatsapp/webhook`) still saves inbound customer messages and updates conversations.
- If mode is `human`, it skips:
  - flow dispatch
  - `runAutomationsForTrigger(...)`

### Human takeover behavior

- Manual admin text send (`/api/whatsapp/send`) sets:
  - `automation_mode = 'human'`
- Manual admin image send (`/api/whatsapp/send-media`) also sets:
  - `automation_mode = 'human'`

---

## 2) n8n Internal Send (Inbox Sync for Bot Replies)

### Problem solved

When n8n sends directly to Meta, customers receive messages but CRM does not insert those outbound bot messages into `messages`, so they do not appear in Inbox.

### New endpoint

- `POST /api/internal/n8n/send-message`
- Auth header required:
  - `x-internal-secret: <N8N_INTERNAL_SECRET>`

### Supported payloads

- Text:
  - `conversation_id`, `message_type: "text"`, `content_text`
- Image:
  - `conversation_id`, `message_type: "image"`
  - either `whatsapp_media_id` or `image_url`
  - optional `content_text` as caption

### Endpoint behavior

1. Validates secret and payload
2. Uses server-side service-role client
3. Loads conversation + contact + owner WhatsApp config
4. Sends via Meta (with phone variant retry)
5. Inserts message row as `sender_type='bot'`
6. Updates conversation preview fields

### Why this keeps inbox synced

Because outbound AI messages are persisted into CRM DB by Huygen server after Meta send succeeds.

---

## 3) Admin Image Send in Inbox

### New endpoint

- `POST /api/whatsapp/send-media`
- Authenticated session required
- Accepts `multipart/form-data`:
  - `conversation_id`
  - `message_type=image`
  - optional `caption`
  - optional `reply_to_message_id`
  - `file`

### Backend flow

1. Validates auth + ownership
2. Uploads image bytes to Meta media endpoint
3. Sends image message
4. Inserts `messages` row with:
  - `sender_type='agent'`
  - `content_type='image'`
  - `media_url='/api/whatsapp/media/<mediaId>'`
5. Updates conversation preview + switches mode to human

### Composer UI changes

- Attach image button
- Hidden file input (`accept=image/*`)
- Paste image from clipboard
- Preview + remove selected image
- Sends caption + image in one action

---

## 4) Media Actions in Message Bubbles

For image messages in Inbox:

- Open
- Download
- Copy image (clipboard API)
- Copy link fallback

For document messages:

- Open
- Download
- Copy link

All actions use proxied media URLs (`/api/whatsapp/media/<id>`) from the stored message data.

---

## 5) Automation Engine Compatibility

Webhook automation context was extended with:

- `conversation_id`
- `contact_id`
- `customer_phone`
- `customer_name`
- `automation_mode`

Automation engine `send_webhook` step now also guards against human mode:

- skips webhook call if `automation_mode === 'human'`

This prevents alternate trigger paths from accidentally sending webhooks during human takeover.

---

## 6) Environment Variable

New required variable for internal n8n send endpoint:

- `N8N_INTERNAL_SECRET`

Added in `.env.local.example` as documentation comment.

---

## 7) Operational Notes

- If you see PostgREST schema-cache errors after running migrations (for example table not found in schema cache), run:

```sql
NOTIFY pgrst, 'reload schema';
SELECT pg_notification_queue_usage();
```

- Confirm the migration was applied to the same Supabase project/branch used by the app environment.

---

## 8) Quick Verification Checklist

1. Toggle conversation to Human Mode.
2. Send inbound customer message and verify:
   - message is saved in inbox
   - no automations/webhooks fire
3. Toggle back to Agent Mode and verify automation dispatch resumes.
4. Configure n8n to call `/api/internal/n8n/send-message` and verify bot message appears in inbox with `sender_type='bot'`.
5. Send image from composer and verify customer receives image and inbox shows sent image bubble.
