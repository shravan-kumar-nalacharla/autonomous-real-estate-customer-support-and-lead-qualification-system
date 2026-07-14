import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedLeadRequirements } from "./types";

export interface PropertyMatch {
  property_id: string;
  property?: PublicPropertyDetails;
  match_score: number;
  matching_reasons: string[];
}

export interface PublicPropertyDetails {
  id: string;
  title: string;
  property_type: string;
  listing_type: string;
  listing_intent?: string | null;
  property_category?: string | null;
  property_stage?: string | null;
  location: string;
  locality: string | null;
  city?: string | null;
  bedrooms: number | null;
  bathrooms?: number | null;
  area_sqft?: number | null;
  area_min?: number | null;
  area_max?: number | null;
  area_unit?: string | null;
  price: number;
  amenities?: string[];
  description?: string | null;
}

interface PropertyRow {
  id: string;
  title: string;
  property_type: string;
  listing_type: "sale" | "rent";
  location: string;
  locality: string | null;
  bedrooms: number | null;
  bathrooms?: number | null;
  area_sqft?: number | null;
  area_min?: number | null;
  area_max?: number | null;
  area_unit?: string | null;
  price: number;
  listing_intent?: string | null;
  property_category?: string | null;
  property_stage?: string | null;
  city?: string | null;
  amenities?: string[];
  description?: string | null;
}

export async function findPropertyMatches(args: {
  db: SupabaseClient;
  organizationId: string;
  requirements: ParsedLeadRequirements;
  limit?: number;
}): Promise<PropertyMatch[]> {
  const { data, error } = await args.db
    .from("properties")
    .select(
      "id, title, property_type, listing_type, listing_intent, property_category, property_stage, location, locality, city, bedrooms, bathrooms, area_sqft, area_min, area_max, area_unit, price, amenities, description",
    )
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
  const intent = normalizeIntent(requirements.listing_intent);
  const propertyIntent = normalizeIntent(property.listing_intent ?? property.listing_type);
  if (intent && propertyIntent === intent) {
    score += 12;
    reasons.push(`matches ${intent} intent`);
  }

  if (
    requirements.property_category &&
    requirements.property_category !== "unknown" &&
    normalize(property.property_category ?? "").includes(normalize(requirements.property_category))
  ) {
    score += 12;
    reasons.push(`matches ${requirements.property_category} category`);
  }

  if (
    requirements.property_type &&
    normalize(property.property_type).includes(normalize(requirements.property_type))
  ) {
    score += 20;
    reasons.push(`matches requested property type ${requirements.property_type}`);
  }

  if (requirements.preferred_locations?.length) {
    const haystack = `${property.location} ${property.locality ?? ""} ${property.city ?? ""}`.toLowerCase();
    const locationHit = requirements.preferred_locations.find((location) =>
      fuzzyIncludes(haystack, location),
    );
    if (locationHit) {
      score += 25;
      reasons.push(`is in ${locationHit}`);
    }
  }

  const bedrooms = requirements.bedrooms ?? requirements.bedroom_count;
  if (bedrooms && property.bedrooms === bedrooms) {
    score += 15;
    reasons.push(`has ${bedrooms} bedrooms`);
  }

  const min = requirements.budget_min;
  const max = requirements.budget_max;
  if ((min == null || property.price >= min) && (max == null || property.price <= max)) {
    if (min != null || max != null) {
      score += 25;
      reasons.push("is within the stated budget range");
    }
  }

  if (
    requirements.area_unit &&
    property.area_unit &&
    normalize(requirements.area_unit) === normalize(property.area_unit)
  ) {
    score += 5;
    reasons.push(`uses ${requirements.area_unit} area unit`);
  }

  if (requirements.area_min != null || requirements.area_max != null) {
    const propertyArea = property.area_sqft ?? property.area_max ?? property.area_min;
    if (
      propertyArea != null &&
      (requirements.area_min == null || propertyArea >= requirements.area_min) &&
      (requirements.area_max == null || propertyArea <= requirements.area_max)
    ) {
      score += 12;
      reasons.push("matches requested area range");
    }
  }

  if (
    requirements.property_stage &&
    requirements.property_stage !== "unknown" &&
    normalize(property.property_stage ?? "").includes(normalize(requirements.property_stage))
  ) {
    score += 9;
    reasons.push(`matches ${requirements.property_stage} stage`);
  }

  return {
    property_id: property.id,
    property: toPublicProperty(property),
    match_score: Math.min(100, score),
    matching_reasons: reasons,
  };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeIntent(value?: string | null) {
  if (!value || value === "unknown") return null;
  if (value === "sale") return "buy";
  if (value === "rent") return "rent";
  return value;
}

function fuzzyIncludes(haystack: string, needle: string) {
  const normalizedNeedle = needle.toLowerCase().trim();
  if (!normalizedNeedle) return false;
  if (haystack.includes(normalizedNeedle)) return true;
  const parts = normalizedNeedle.split(/\s+/).filter((part) => part.length > 2);
  return parts.length > 0 && parts.every((part) => haystack.includes(part));
}

function toPublicProperty(property: PropertyRow): PublicPropertyDetails {
  return {
    id: property.id,
    title: property.title,
    property_type: property.property_type,
    listing_type: property.listing_type,
    listing_intent: property.listing_intent ?? null,
    property_category: property.property_category ?? null,
    property_stage: property.property_stage ?? null,
    location: property.location,
    locality: property.locality,
    city: property.city ?? null,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms ?? null,
    area_sqft: property.area_sqft ?? null,
    area_min: property.area_min ?? null,
    area_max: property.area_max ?? null,
    area_unit: property.area_unit ?? null,
    price: property.price,
    amenities: property.amenities ?? [],
    description: property.description ?? null,
  };
}
