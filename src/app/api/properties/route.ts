import { NextResponse } from "next/server";
import { requireOrganizationContext } from "@/lib/organizations";

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  const guard = await requireOrganizationContext();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase
    .from("properties")
    .select("*")
    .eq("organization_id", guard.organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ properties: data ?? [] });
}

export async function POST(request: Request) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager"]);
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = String(body.title ?? "").trim();
  const propertyType = String(body.property_type ?? "").trim();
  const listingType = String(body.listing_type ?? "").trim();
  const location = String(body.location ?? "").trim();
  const price = optionalNumber(body.price);

  if (!title || !propertyType || !location || price == null) {
    return NextResponse.json(
      { error: "title, property_type, location, and price are required" },
      { status: 400 },
    );
  }
  if (listingType !== "sale" && listingType !== "rent") {
    return NextResponse.json(
      { error: "listing_type must be sale or rent" },
      { status: 400 },
    );
  }

  const { data, error } = await guard.supabase
    .from("properties")
    .insert({
      organization_id: guard.organizationId,
      title,
      property_type: propertyType,
      listing_type: listingType,
      status: String(body.status ?? "available"),
      location,
      locality: String(body.locality ?? "").trim() || null,
      bedrooms: optionalNumber(body.bedrooms),
      bathrooms: optionalNumber(body.bathrooms),
      area_sqft: optionalNumber(body.area_sqft),
      price,
      amenities: Array.isArray(body.amenities) ? body.amenities : [],
      description: String(body.description ?? "").trim() || null,
      assigned_agent_id: guard.user.id,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create property" },
      { status: 500 },
    );
  }
  return NextResponse.json({ property: data }, { status: 201 });
}
