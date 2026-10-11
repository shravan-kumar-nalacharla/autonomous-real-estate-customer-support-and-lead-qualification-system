# Real Estate AI Agent

AI-powered WhatsApp CRM for real-estate teams. It qualifies buyers, renters,
sellers, and investors; matches available properties; records site-visit
requests; schedules follow-ups; and hands sensitive conversations to people.

The app is the secure system of record. Supabase stores tenant-scoped CRM data,
the Next.js backend validates and commits agent actions, and n8n orchestrates the
specialist agents. Customer replies are sent through the backend so WhatsApp
messages and the shared inbox stay synchronized.

Based on [wacrm](https://github.com/ArnasDon/wacrm) by ArnasDon (MIT License).

## Core capabilities

- Shared WhatsApp inbox with human/AI ownership controls
- Real-estate lead requirements and explainable scoring
- Tenant-scoped property matching and recommendations
- Site-visit requests, follow-up tasks, and pipeline stages
- Human handoff for explicit agent requests and sensitive enquiries
- n8n event idempotency, audit logs, and backend-controlled WhatsApp sending
- Organization membership and Supabase Row Level Security

## Quick start

```bash
git clone https://github.com/shravan-kumar-nalacharla/autonomous-real-estate-customer-support-and-lead-qualification-system.git
cd autonomous-real-estate-customer-support-and-lead-qualification-system
npm install
copy .env.local.example .env.local
npm run dev
```

Configure Supabase, Meta WhatsApp Cloud API, and the internal n8n secrets in
`.env.local` before testing live messages.

## n8n real-estate agent

Import `n8n/Real Estate AI Agent - Production v15.json`
into n8n. It calls five protected backend routes for context, property matching,
plan commits, WhatsApp sends, and event completion.

```text
N8N_INBOUND_SECRET
N8N_INTERNAL_SECRET
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
HUYGEN_BASE_URL
OPENAI_API_KEY
OPENAI_MODEL=gpt-4o-mini
```

`HUYGEN_*` variables, `X-Huygen-*` headers, the `huygen-warp` event source,
and existing browser storage keys remain compatibility identifiers. They are
not the visible product name and changing them would break deployed contracts.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Supabase, Meta WhatsApp Cloud
API, and n8n.

## License

MIT. Attribution: based on wacrm by ArnasDon.
