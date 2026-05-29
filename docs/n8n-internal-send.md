# n8n Internal Send Endpoint

Use this endpoint when n8n needs to send replies back to WhatsApp **and** keep the Huygen inbox in sync.

Instead of sending directly from n8n to Meta, call Huygen:

- Endpoint: `POST /api/internal/n8n/send-message`
- Auth header: `x-internal-secret: <N8N_INTERNAL_SECRET>`

## Required env var

Set this in the Huygen app server:

```bash
N8N_INTERNAL_SECRET=your-long-random-secret
```

If the header is missing or invalid, the endpoint returns `401`.

## Why this endpoint exists

When n8n sends directly to Meta, the customer receives the message but Huygen never inserts it into `messages`, so it does not appear in the inbox.

This endpoint:

1. Sends to Meta on behalf of the workspace owner.
2. Inserts the outbound message into `messages` with `sender_type='bot'`.
3. Updates conversation preview fields.

## n8n HTTP Request node (text)

- Method: `POST`
- URL: `https://<your-huygen-domain>/api/internal/n8n/send-message`
- Headers:
  - `Content-Type: application/json`
  - `x-internal-secret: {{$env.N8N_INTERNAL_SECRET}}` (or hardcoded secret)
- Body:

```json
{
  "conversation_id": "8f41d6b7-86a5-4fe1-88f7-8f0e7a61f2d8",
  "message_type": "text",
  "content_text": "Here are the kitchen options that match your style."
}
```

## n8n HTTP Request node (image by URL)

```json
{
  "conversation_id": "8f41d6b7-86a5-4fe1-88f7-8f0e7a61f2d8",
  "message_type": "image",
  "image_url": "https://example.com/kitchen.jpg",
  "content_text": "Option 1: warm wood + matte white"
}
```

The endpoint downloads and uploads this image to WhatsApp, sends it to the customer, and stores a proxied media URL in the inbox.

## n8n HTTP Request node (image by existing WhatsApp media id)

```json
{
  "conversation_id": "8f41d6b7-86a5-4fe1-88f7-8f0e7a61f2d8",
  "message_type": "image",
  "whatsapp_media_id": "123456789012345",
  "content_text": "Reference image"
}
```

## Response

Success response:

```json
{
  "success": true,
  "message_id": "internal-db-message-uuid",
  "whatsapp_message_id": "wamid.HBgM..."
}
```

