import type {
  LeadCategory,
  LeadScoreResult,
  ParsedLeadRequirements,
} from "./types";

export function scoreLead(
  requirements: ParsedLeadRequirements & { hasVerifiedContact?: boolean },
): LeadScoreResult {
  const breakdown: Record<string, number> = {};

  if (requirements.preferred_locations?.length) breakdown.preferred_location = 15;
  if (requirements.budget_min != null || requirements.budget_max != null) {
    breakdown.budget = 20;
  }
  if (requirements.property_type) breakdown.property_type = 15;
  if (requirements.timeline) breakdown.timeline = 20;
  if (requirements.site_visit_interest) breakdown.site_visit_requested = 20;
  if (requirements.hasVerifiedContact) breakdown.verified_contact = 10;

  const score = Math.min(
    100,
    Object.values(breakdown).reduce((sum, value) => sum + value, 0),
  );
  const category = categorizeLead(score, requirements);
  const earned = Object.keys(breakdown).map((key) => key.replaceAll("_", " "));
  const missing = [
    ["preferred location", !requirements.preferred_locations?.length],
    ["budget", requirements.budget_min == null && requirements.budget_max == null],
    ["property type", !requirements.property_type],
    ["timeline", !requirements.timeline],
    ["site visit interest", !requirements.site_visit_interest],
  ]
    .filter(([, isMissing]) => isMissing)
    .map(([label]) => label);

  return {
    score,
    category,
    breakdown,
    explanation:
      earned.length === 0
        ? "Insufficient qualifying details collected yet."
        : `Score is based on ${earned.join(", ")}.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}`,
  };
}

export function categorizeLead(
  score: number,
  requirements: ParsedLeadRequirements,
): LeadCategory {
  const hasAnyRequirement = Boolean(
    requirements.preferred_locations?.length ||
      requirements.budget_min != null ||
      requirements.budget_max != null ||
      requirements.property_type ||
      requirements.timeline ||
      requirements.site_visit_interest,
  );
  if (!hasAnyRequirement) return "general_enquiry";
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}
