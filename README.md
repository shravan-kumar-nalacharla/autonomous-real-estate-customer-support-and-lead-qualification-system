# Huygen Warp

> WhatsApp AI CRM & automation platform. Self-hostable, open-source fork.

Based on [wacrm](https://github.com/ArnasDon/wacrm) by ArnasDon (MIT License).

## What's new in Huygen Warp

- **Rebranded UI** - clean, minimal Anthropic-inspired design system
- **n8n Workflows page** - connect your self-hosted n8n instance, manage webhook
  automations per-event, toggle on/off without touching code
- **Full wacrm feature set** - shared WhatsApp inbox, contacts, pipeline, broadcasts,
  no-code automations, dashboard

## Quick start

```bash
git clone https://github.com/<your-username>/huygen-warp.git
cd huygen-warp
npm install
cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm run dev
```

## n8n Integration

1. Host n8n (we use [Render.com](https://render.com) - free tier works)
2. In n8n: create a Webhook node -> copy the webhook URL
3. In Huygen Warp: go to **n8n Workflows** in the sidebar
4. Click **+ Add Workflow**, paste the webhook URL, choose your trigger event
5. Toggle the workflow ON - events will start flowing

The platform sends a POST request to your n8n webhook on every CRM event:

```json
{
  "event": "message.received",
  "payload": { "contactId": "...", "message": "...", "customerPhone": "..." },
  "timestamp": "2025-01-01T00:00:00.000Z",
  "source": "huygen-warp"
}
```

## Stack

- Next.js 16 (App Router) - React 19 - TypeScript - Tailwind v4
- Supabase (Postgres + Auth + RLS)
- WhatsApp Business API (Meta Cloud API)
- n8n (self-hosted webhooks)

## License

MIT - fork it, brand it, ship it.
Attribution: Based on wacrm by ArnasDon.
