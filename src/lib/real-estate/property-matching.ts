import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedLeadRequirements } from "./types";

export interface PropertyMatch {
  property_id: string;
  match_score: number;
  matching_reasons: string[];
}

interface PropertyRow {
  id: string;
  title: string;
  property_type: string;
  listing_type: "sale" | "rent";
  location: string;
  locality: string | null;
  bedrooms: number | null;
  price: number;
}

export async function findPropertyMatches(args: {
  db: SupabaseClient;
  organizationId: string;
  requirements: ParsedLeadRequirements;
  limit?: number;
}): Promise<PropertyMatch[]> {
  const { data, error } = await args.db
    .from("properties")
    .select("id, title, property_type, listing_type, location, locality, bedrooms, price")
    .eq("organization_id", args.organizationId)
    .eq("status", "available")
    .limit(50);

  if (error || !data) {
    if (error) console.error("[property_matching] query failed:", error.message);
    return [];
  }

  return (data as PropertyRow[])
    .map((property) => scoreProperty(property, args.requirements))
    .filter((match) => match.match_score > 0)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, args.limit ?? 3);
}

function scoreProperty(
  property: PropertyRow,
  requirements: ParsedLeadRequirements,
): PropertyMatch {
  let score = 0;
  const reasons: string[] = [];

  if (requirements.listing_type && property.listing_type === requirements.listing_type) {
    score += 15;
    reasons.push(`matches ${requirements.listing_type} intent`);
  }

  if (
    requirements.property_type &&
    normalize(property.property_type).includes(normalize(requirements.property_type))
  ) {
    score += 20;
    reasons.push(`matches requested property type ${requirements.property_type}`);
  }

  if (requirements.preferred_locations?.length) {
    const haystack = `${property.location} ${property.locality ?? ""}`.toLowerCase();
    const locationHit = requirements.preferred_locations.find((location) =>
      haystack.includes(location.toLowerCase()),
    );
    if (locationHit) {
      score += 25;
      reasons.push(`is in ${locationHit}`);
    }
  }

  if (requirements.bedroom_count && property.bedrooms === requirements.bedroom_count) {
    score += 15;
    reasons.push(`has ${requirements.bedroom_count} bedrooms`);
  }

  const min = requirements.budget_min;
  const max = requirements.budget_max;
  if ((min == null || property.price >= min) && (max == null || property.price <= max)) {
    if (min != null || max != null) {
      score += 25;
      reasons.push("is within the stated budget range");
    }
  }

  return {
    property_id: property.id,
    match_score: Math.min(100, score),
    matching_reasons: reasons,
  };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
