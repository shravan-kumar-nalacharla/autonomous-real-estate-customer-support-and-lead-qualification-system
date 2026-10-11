import { NextResponse } from 'next/server';
import { requireOrganizationContext } from '@/lib/organizations';

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  const guard = await requireOrganizationContext(['owner', 'admin', 'manager']);
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const title = String(body.title ?? '').trim();
  const propertyType = String(body.property_type ?? '').trim();
  const listingType = String(body.listing_type ?? '').trim();
  const location = String(body.location ?? '').trim();
  const price = optionalNumber(body.price);

  if (!title || !propertyType || !location || price == null) {
    return NextResponse.json(
      { error: 'title, property_type, location, and price are required' },
      { status: 400 }
    );
  }
  if (listingType !== 'sale' && listingType !== 'rent') {
    return NextResponse.json(
      { error: 'listing_type must be sale or rent' },
      { status: 400 }
    );
  }

  const { propertyId } = await params;
  const { data, error } = await guard.supabase
    .from('properties')
    .update({
      title,
      property_type: propertyType,
      listing_type: listingType,
      location,
      locality: String(body.locality ?? '').trim() || null,
      bedrooms: optionalNumber(body.bedrooms),
      price,
    })
    .eq('organization_id', guard.organizationId)
    .eq('id', propertyId)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 });
  }
  return NextResponse.json({ property: data });
}
