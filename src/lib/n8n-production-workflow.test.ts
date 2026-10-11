import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface WorkflowNode {
  name: string;
  parameters?: { jsCode?: string };
}

const workflow = JSON.parse(
  readFileSync(
    join(process.cwd(), 'n8n/Real Estate AI Agent - Production v16.json'),
    'utf8'
  )
) as { name: string; nodes: WorkflowNode[] };

function code(name: string) {
  return (
    workflow.nodes.find((node) => node.name === name)?.parameters?.jsCode ?? ''
  );
}

describe('production n8n workflow', () => {
  it('routes button titles when an inbound payload loses the reply id', () => {
    const source = code('Normalize + Authenticate Real Estate AI Agent Event');
    expect(source).toContain("'hi': 'show_menu'");
    expect(source).toContain("'find property': 'find_property'");
    expect(source).toContain("'book site visit': 'book_site_visit'");
    expect(source).toContain("'talk to agent': 'talk_to_agent'");
  });

  it('advances Find Property instead of resending the welcome menu', () => {
    const source = code('Appointment, Follow-up & Escalation Agents');
    expect(source).toContain("actionId === 'find_property'");
    expect(source).toContain("id: 'buy'");
    expect(source).toContain("id: 'rent'");
    expect(source).toContain("id: 'sell_lease'");
    expect(source).toContain('menuWasRecentlySent');
  });

  it('trusts deterministic button actions instead of the AI confidence score', () => {
    const source = code('Parse & Validate Orchestrator Output');
    const run = new Function('$input', '$', source);
    const base = {
      event: { interactive_reply_id: 'buy' },
      config: {},
      context: { lead_requirements: {} },
      is_opt_out_request: false,
    };
    const result = run(
      {
        first: () => ({
          json: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intent: 'unknown',
                    confidence: 0,
                    extracted: {},
                  }),
                },
              },
            ],
          },
        }),
      },
      () => ({ first: () => ({ json: base }) })
    ) as Array<{
      json: {
        orchestrator: {
          confidence: number;
          requirements: { listing_intent: string };
        };
      };
    }>;

    expect(result[0].json.orchestrator.confidence).toBe(1);
    expect(result[0].json.orchestrator.requirements.listing_intent).toBe('buy');
  });

  it('always renders interactive buttons for an explicit greeting', () => {
    const source = code('Appointment, Follow-up & Escalation Agents');
    expect(source).toContain("actionId === 'show_menu'");
    expect(source).toContain('rawWhatsappPayload = menuPayload');
  });

  it('reads nested property matches and carries a Drive image into the send request', () => {
    const mergeSource = code('Merge Property Matching Result');
    const merged = new Function('$input', '$', mergeSource)(
      {
        first: () => ({
          json: {
            matches: [
              {
                property_id: 'property-1',
                property: {
                  id: 'property-1',
                  title: 'Kondapur Apartment',
                  locality: 'Kondapur',
                  price: 8000000,
                  property_type: 'apartment',
                  bedrooms: 2,
                  listing_type: 'sale',
                },
                match_score: 90,
                matching_reasons: ['matches apartment'],
              },
            ],
            image: {
              file_id: 'drive-file-1',
              filename: 'demo-sale-apartment-modern-exterior-01.jpg',
              kind: 'representative',
            },
          },
        }),
      },
      () => ({
        first: () => ({
          json: {
            qualification: { requirements: { currency: 'INR' } },
            agent_activities: [],
          },
        }),
      })
    ) as Array<{
      json: {
        property_matches: Array<{ id: string; title: string }>;
        drive_image: { file_id: string };
      };
    }>;

    expect(merged[0].json.property_matches[0]).toMatchObject({
      id: 'property-1',
      title: 'Kondapur Apartment',
    });
    expect(merged[0].json.drive_image.file_id).toBe('drive-file-1');

    const replySource = code('Appointment, Follow-up & Escalation Agents');
    const buildSource = code('Build Durable Multi-Agent Plan');
    expect(replySource).toContain("messageType = 'image'");
    expect(replySource).toContain(
      'googleDriveFileId = input.drive_image.file_id'
    );
    expect(buildSource).toContain(
      'google_drive_file_id: input.outbound_message.google_drive_file_id'
    );
    expect(JSON.stringify(workflow)).toContain('google_drive_file_id');
  });

  it('persists and follows up site-visit requests with customer timing', () => {
    const source = code('Appointment, Follow-up & Escalation Agents');
    expect(source).toContain("reason: 'Confirm site visit request'");
    expect(source).toContain(
      'preferred_at: q.requirements.preferred_appointment_at'
    );
    expect(source).toContain('Preferred time: ${preferredVisitDetails}');
    expect(source).toContain('pending confirmation in Appointments');
  });
});
