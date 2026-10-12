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

  it('does not mistake the Book Site Visit button title for a date or time', () => {
    const source = code('Parse & Validate Orchestrator Output');
    const run = new Function('$input', '$', source);
    const base = {
      event: {
        message_text: 'Book Site Visit',
        interactive_reply_id: 'book_site_visit',
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
                    intent: 'appointment_request',
                    confidence: 1,
                    extracted: {
                      site_visit_interest: 'yes',
                      preferred_appointment_time: 'Book Site Visit',
                    },
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
            preferred_appointment_date: string;
            preferred_appointment_time: string;
            preferred_appointment_at: string;
          };
        };
      };
    }>;

    expect(result[0].json.orchestrator.requirements).toMatchObject({
      preferred_appointment_date: '',
      preferred_appointment_time: '',
      preferred_appointment_at: '',
    });
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
            drive_image: {
              file_id: 'drive-2bhk',
              filename: 'demo-sale-apartment-2bhk-bedroom-01.jpg',
              resource_key: null,
              kind: 'representative',
            },
            agent_activities: [],
          },
        }),
      }) as Array<{
        json: {
          outbound_message: {
            message_type: string;
            content_text: string;
            raw_whatsapp_payload: {
              header?: { type: string };
              action: { buttons: Array<{ reply: { id: string } }> };
            };
            google_drive_file_id: string | null;
          };
        };
      }>;

    const intentQuestion = run({
      bedrooms: 2,
      property_type: 'unknown',
      listing_intent: 'unknown',
    })[0].json.outbound_message;
    expect(intentQuestion.message_type).toBe('interactive');
    expect(intentQuestion.google_drive_file_id).toBe('drive-2bhk');
    expect(intentQuestion.raw_whatsapp_payload.header).toEqual({
      type: 'image',
    });
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
    expect(source).toContain("const orgName = 'EastWest Real Estates'");
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

  it('sends a representative image even when inventory has no matching rows', () => {
    const source = code('Appointment, Follow-up & Escalation Agents');
    const result = new Function('$input', source)({
      first: () => ({
        json: {
          event: { message_text: 'Show 2bhk flats' },
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
            requirements: {
              bedrooms: 2,
              property_type: 'apartment',
              listing_intent: 'buy',
            },
            lead_category: 'warm',
            can_match_properties: true,
            missing_fields: [],
          },
          property_matches: [],
          drive_image: {
            file_id: 'drive-2bhk',
            filename: 'demo-sale-apartment-2bhk-bedroom-01.jpg',
            resource_key: null,
            kind: 'representative',
          },
          agent_activities: [],
        },
      }),
    }) as Array<{
      json: {
        outbound_message: {
          message_type: string;
          content_text: string;
          google_drive_file_id: string;
        };
      };
    }>;

    expect(result[0].json.outbound_message).toMatchObject({
      message_type: 'image',
      google_drive_file_id: 'drive-2bhk',
    });
    expect(result[0].json.outbound_message.content_text).toContain(
      'Representative image for this property type.'
    );
  });

  it('creates site-visit requests only after time, property type, and location are known', () => {
    const source = code('Appointment, Follow-up & Escalation Agents');
    expect(source).toContain("reason: 'Confirm site visit request'");
    expect(source).toContain(
      'preferred_at: q.requirements.preferred_appointment_at'
    );
    expect(source).toContain('if (appointmentReady)');
    expect(source).toContain("missingVisitFields.push('property type')");
    expect(source).toContain("missingVisitFields.push('location')");
    expect(source).toContain("missingVisitFields.push('date and time')");
    expect(source).toContain('after an admin confirms the slot');
  });

  it('asks for missing visit details before emitting an appointment request', () => {
    const source = code('Appointment, Follow-up & Escalation Agents');
    const run = new Function('$input', source);
    const makeInput = (requirements: Record<string, unknown>) => ({
      first: () => ({
        json: {
          event: {
            message_text: 'Book a site visit',
            interactive_reply_id: '',
          },
          config: { hotFollowupHours: 2, defaultFollowupHours: 24 },
          context: { contact: {}, conversation: { automation_mode: 'agent' } },
          orchestrator: {
            intent: 'appointment_request',
            confidence: 0.9,
            requires_human: false,
          },
          qualification: {
            requirements,
            lead_category: 'warm',
            can_match_properties: false,
            missing_fields: [],
          },
          property_matches: [],
          agent_activities: [],
          is_opt_out_request: false,
        },
      }),
    });

    const incomplete = run(
      makeInput({
        site_visit_interest: 'yes',
        property_type: 'unknown',
        preferred_locations: [],
        preferred_appointment_at: '',
      })
    ) as Array<{
      json: {
        appointment_request: unknown;
        outbound_message: { message_type: string; content_text: string };
      };
    }>;
    expect(incomplete[0].json.appointment_request).toBeNull();
    expect(incomplete[0].json.outbound_message.message_type).toBe(
      'interactive'
    );
    expect(incomplete[0].json.outbound_message.content_text).toContain(
      'property type, location and date and time'
    );

    const complete = run(
      makeInput({
        site_visit_interest: 'yes',
        property_type: 'villa',
        preferred_locations: ['Gachibowli'],
        preferred_appointment_date: '2026-10-13',
        preferred_appointment_time: '10:00 AM',
        preferred_appointment_at: '2026-10-13T10:00:00+05:30',
      })
    ) as Array<{
      json: {
        appointment_request: { preferred_at: string; notes: string };
        outbound_message: { content_text: string };
      };
    }>;
    expect(complete[0].json.appointment_request).toMatchObject({
      preferred_at: '2026-10-13T10:00:00+05:30',
    });
    expect(complete[0].json.appointment_request.notes).toContain(
      'villa in Gachibowli'
    );
    expect(complete[0].json.outbound_message.content_text).toContain(
      'after an admin confirms the slot'
    );
  });
});
