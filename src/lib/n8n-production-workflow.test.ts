import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface WorkflowNode {
  name: string;
  parameters?: { jsCode?: string };
}

const workflow = JSON.parse(
  readFileSync(
    join(process.cwd(), 'n8n/Real Estate AI Agent - Production v14.json'),
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

  it('always renders interactive buttons for an explicit greeting', () => {
    const source = code('Appointment, Follow-up & Escalation Agents');
    expect(source).toContain("actionId === 'show_menu'");
    expect(source).toContain('rawWhatsappPayload = menuPayload');
  });
});
