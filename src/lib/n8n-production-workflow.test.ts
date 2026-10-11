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

  it('deterministically detects BHK and flat requests even when the AI omits them', () => {
    const source = code('Parse & Validate Orchestrator Output');
    const run = new Function('$input', '$', source);
    const base = {
      event: {
        message_text: 'I need 2 bhk flat',
        interactive_reply_id: '',
      },
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
                    intent: 'property_search',
                    confidence: 0.8,
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
          requirements: {
            bedrooms: number;
            property_type: string;
            property_category: string;
            listing_intent: string;
          };
        };
      };
    }>;

    expect(result[0].json.orchestrator.requirements).toMatchObject({
      bedrooms: 2,
      property_type: 'apartment',
      property_category: 'residential',
      listing_intent: 'unknown',
    });
    expect(JSON.stringify(workflow)).toContain(
      '$json.qualification.requirements.property_type'
    );
  });

  it('uses interactive buttons to qualify partial BHK and villa searches', () => {
    const source = code('Appointment, Follow-up & Escalation Agents');
    const run = (requirements: Record<string, unknown>) =>
      new Function('$input', source)({
        first: () => ({
          json: {
            event: { message_text: 'I need 2 bhk' },
            config: { defaultFollowupHours: 24, hotFollowupHours: 2 },
            context: {
              contact: {},
              conversation: { automation_mode: 'agent' },
            },
            orchestrator: {
              intent: 'property_search',
              confidence: 1,
              requires_human: false,
            },
            is_opt_out_request: false,
            qualification: {
              requirements,
              lead_category: 'cold',
              can_match_properties: false,
              missing_fields: [],
            },
            property_matches: [],
            agent_activities: [],
          },
        }),
      }) as Array<{
        json: {
          outbound_message: {
            message_type: string;
            content_text: string;
            raw_whatsapp_payload: {
              action: { buttons: Array<{ reply: { id: string } }> };
            };
          };
        };
      }>;

    const intentQuestion = run({
      bedrooms: 2,
      property_type: 'unknown',
      listing_intent: 'unknown',
    })[0].json.outbound_message;
    expect(intentQuestion.message_type).toBe('interactive');
    expect(intentQuestion.content_text).toContain(
      '2 BHK. Are you looking to buy or rent?'
    );
    expect(
      intentQuestion.raw_whatsapp_payload.action.buttons.map(
        (button) => button.reply.id
      )
    ).toEqual(['buy', 'rent', 'sell_lease']);

    const propertyTypeQuestion = run({
      bedrooms: 2,
      property_type: 'unknown',
      listing_intent: 'buy',
    })[0].json.outbound_message;
    expect(propertyTypeQuestion.message_type).toBe('interactive');
    expect(
      propertyTypeQuestion.raw_whatsapp_payload.action.buttons.map(
        (button) => button.reply.id
      )
    ).toEqual(['apartment', 'villa', 'independent_house']);
    const normalizeSource = code(
      'Normalize + Authenticate Real Estate AI Agent Event'
    );
    expect(normalizeSource).toContain("'flat/apartment': 'apartment'");
    expect(normalizeSource).toContain("'villa': 'villa'");
    expect(normalizeSource).toContain(
      "'independent house': 'independent_house'"
    );

    const villaQuestion = run({
      property_type: 'villa',
      listing_intent: 'unknown',
    })[0].json.outbound_message;
    expect(villaQuestion.content_text).toContain(
      'villa. Are you looking to buy or rent?'
    );
  });

  it('asks for missing search details before querying property inventory', () => {
    const source = code('Lead Qualification Agent - Score & Classify');
    const run = new Function('$input', source);
    const qualify = (requirements: Record<string, unknown>) =>
      run({
        first: () => ({
          json: {
            event: { message_text: 'I want a villa' },
            config: { defaultFollowupHours: 24, hotFollowupHours: 2 },
            context: { contact: { phone: '+919999999999' } },
            is_opt_out_request: false,
            orchestrator: {
              intent: 'property_search',
              confidence: 1,
              requirements,
            },
          },
        }),
      }) as Array<{
        json: {
          qualification: {
            can_match_properties: boolean;
            missing_fields: string[];
          };
        };
      }>;

    const partial = qualify({
      listing_intent: 'buy',
      property_type: 'villa',
      preferred_locations: [],
      budget_min: null,
      budget_max: null,
      area_min: null,
      area_max: null,
    });
    expect(partial[0].json.qualification.can_match_properties).toBe(false);
    expect(partial[0].json.qualification.missing_fields).toEqual(
      expect.arrayContaining(['preferred location', 'budget range'])
    );

    const reply = new Function(
      '$input',
      code('Appointment, Follow-up & Escalation Agents')
    )({ first: () => ({ json: partial[0].json }) }) as Array<{
      json: { outbound_message: { content_text: string } };
    }>;
    expect(reply[0].json.outbound_message.content_text).toBe(
      'To suggest suitable properties, please share your preferred location and budget range.'
    );

    const searchable = qualify({
      listing_intent: 'buy',
      property_type: 'villa',
      preferred_locations: ['Kondapur'],
      budget_max: 20_000_000,
    });
    expect(searchable[0].json.qualification.can_match_properties).toBe(true);
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
                  bedrooms: 3,
                  listing_type: 'sale',
                },
                match_score: 90,
                matching_reasons: ['matches apartment'],
                alternative_reasons: [
                  'closest available configuration is 3 BHK instead of 2 BHK',
                ],
                is_exact_match: false,
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
            event: { message_text: 'I need 2 bhk flat' },
            config: { defaultFollowupHours: 24, hotFollowupHours: 2 },
            context: {
              contact: {},
              conversation: { automation_mode: 'agent' },
            },
            orchestrator: { intent: 'property_search', confidence: 1 },
            is_opt_out_request: false,
            qualification: {
              requirements: {
                currency: 'INR',
                bedrooms: 2,
                property_type: 'apartment',
                listing_intent: 'buy',
              },
              lead_category: 'warm',
              can_match_properties: true,
              missing_fields: [],
            },
            agent_activities: [],
          },
        }),
      })
    ) as Array<{
      json: {
        property_matches: Array<{
          id: string;
          title: string;
          is_exact_match: boolean;
        }>;
        drive_image: { file_id: string };
      };
    }>;

    expect(merged[0].json.property_matches[0]).toMatchObject({
      id: 'property-1',
      title: 'Kondapur Apartment',
      is_exact_match: false,
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

    const reply = new Function('$input', replySource)({
      first: () => ({ json: merged[0].json }),
    }) as Array<{
      json: {
        outbound_message: {
          message_type: string;
          content_text: string;
          google_drive_file_id: string;
        };
      };
    }>;
    expect(reply[0].json.outbound_message).toMatchObject({
      message_type: 'image',
      google_drive_file_id: 'drive-file-1',
    });
    expect(reply[0].json.outbound_message.content_text).toContain(
      'I do not have an exact 2 BHK match available right now'
    );
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
