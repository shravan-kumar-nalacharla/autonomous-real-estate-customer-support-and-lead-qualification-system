import { describe, expect, it } from 'vitest';
import { normalizeAgentPlanBody } from './route';

describe('normalizeAgentPlanBody', () => {
  it('maps the production n8n v11 plan into the canonical API shape', () => {
    const now = Date.parse('2026-10-11T10:00:00.000Z');
    const normalized = normalizeAgentPlanBody(
      {
        idempotency_key: 'n8n:real-estate:v2:event-1',
        lead_update: {
          requirements: { preferred_locations: ['Hyderabad'] },
          score: 75,
          category: 'hot',
          score_breakdown: [{ points: 15, reason: 'Location captured' }],
          summary: 'Qualified buyer',
        },
        appointment_request: {
          preferred_at: '2026-10-12T09:30:00+05:30',
        },
        follow_up_task: {
          reason: 'Hot lead',
          due_in_hours: 4,
        },
        handoff: { required: true, reason: 'Customer requested an agent' },
        agent_activity_logs: [{ agent_type: 'qualification' }],
      },
      now
    );

    expect(normalized.requirements?.preferred_locations).toEqual(['Hyderabad']);
    expect(normalized.lead_score).toMatchObject({
      score: 75,
      category: 'hot',
      explanation: 'Qualified buyer',
    });
    expect(normalized.appointment_request?.requested_start_at).toBe(
      '2026-10-12T04:00:00.000Z'
    );
    expect(normalized.follow_up_task?.due_at).toBe('2026-10-11T14:00:00.000Z');
    expect(normalized.human_handoff?.required).toBe(true);
    expect(normalized.activity_logs).toHaveLength(1);
  });

  it('keeps canonical fields when both contracts are present', () => {
    const normalized = normalizeAgentPlanBody({
      idempotency_key: 'event-2',
      requirements: { preferred_locations: ['Canonical'] },
      lead_update: {
        requirements: { preferred_locations: ['Legacy'] },
        score: 10,
      },
      lead_score: { score: 90 },
      human_handoff: { required: false },
      handoff: { required: true },
      activity_logs: [],
      agent_activity_logs: [{ agent_type: 'legacy' }],
    });

    expect(normalized.requirements?.preferred_locations).toEqual(['Canonical']);
    expect(normalized.lead_score?.score).toBe(90);
    expect(normalized.human_handoff?.required).toBe(false);
    expect(normalized.activity_logs).toEqual([]);
  });
});
