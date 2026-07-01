# Autonomous Real Estate Customer Support and Lead Qualification System

## Abstract

Real estate agents often lose promising enquiries because they cannot monitor new WhatsApp leads throughout the day. This project implements an organization-scoped WhatsApp CRM that helps real estate agencies respond faster, capture customer requirements, qualify leads, recommend matching properties, request site visits, create follow-up tasks, and hand off important conversations to human sales agents.

The system is built on the existing `huygen-warp` production-oriented repository using Next.js 16, React 19, TypeScript, Supabase, the Meta WhatsApp Business API, n8n, and the repository's stateful WhatsApp Flow engine. It introduces organization-based tenancy so multiple agents can collaborate inside the same agency while data remains isolated between agencies through Supabase Row Level Security and server-side membership checks.

The real-estate automation layer uses deterministic agent services rather than uncontrolled chatbot loops. The Conversation Orchestrator classifies inbound WhatsApp messages, the Lead Qualification Agent extracts requirements and calculates an explainable score, the Property Matching Agent recommends only available organization-owned properties, the Appointment Agent records site-visit requests that require human confirmation, the Follow-up Agent creates internal tasks, and the Human Escalation Agent pauses automation when a qualified or sensitive conversation needs a sales agent.

n8n integration is organization-scoped and uses a durable event outbox. Webhook URLs, API keys, and signing secrets are treated as sensitive configuration and are not returned in plaintext by normal APIs. Outbound n8n delivery is signed with HMAC when a workflow secret is configured and retried asynchronously so the Meta WhatsApp webhook can acknowledge inbound messages quickly.

The project demonstrates how a real estate business can reduce manual effort, improve response time, organize enquiries, protect tenant data, and increase the chance of converting qualified leads into property sales without depending on an external AI API key for core behavior.

## Implemented Capabilities

- Organization and member model with roles: owner, admin, manager, agent.
- Organization-scoped n8n workflows and settings with masked API responses.
- Real-estate property inventory and appointment dashboard pages.
- Lead requirement capture, deterministic scoring, and category assignment.
- Property recommendation records based on budget, location, type, BHK, listing type, and availability.
- Human handoff and agent activity audit records.
- Durable n8n event outbox and secured cron delivery endpoint.
- Next.js 16 `proxy.ts` route protection for dashboard and API routes.

## Known Limitations

- Calendar integration is intentionally deferred; appointments are managed internally first.
- The deterministic parser handles common WhatsApp phrasing but is not a full natural-language understanding engine.
- Existing contact detail pages are not fully redesigned; new lead data is persisted and available for focused dashboard expansion.
- Production Supabase deployments should apply the forward migration and then re-create any quarantined legacy n8n workflows under the correct organization.
