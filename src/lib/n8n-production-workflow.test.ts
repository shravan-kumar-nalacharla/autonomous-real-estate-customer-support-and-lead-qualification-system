import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface WorkflowNode {
  name: string;
  parameters?: { jsCode?: string };
}

const workflow = JSON.parse(
  readFileSync(
    join(process.cwd(), 'n8n/Real Estate AI Agent - Production v15.json'),
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
      () => ({ first: () => ({ json: base }) }),
    ) as Array<{ json: { orchestrator: { confidence: number; requirements: { listing_intent: string } } } }>;

    expect(result[0].json.orchestrator.confidence).toBe(1);
    expect(result[0].json.orchestrator.requirements.listing_intent).toBe('buy');
  });

  it('always renders interactive buttons for an explicit greeting', () => {
    const source = code('Appointment, Follow-up & Escalation Agents');
    expect(source).toContain("actionId === 'show_menu'");
    expect(source).toContain('rawWhatsappPayload = menuPayload');
  });
});
