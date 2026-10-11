import { NextResponse } from 'next/server';
import {
  downloadGoogleDriveImage,
  listGoogleDriveImages,
  selectGoogleDriveImage,
} from '@/lib/google-drive-images';
import { requireOrganizationContext } from '@/lib/organizations';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  const guard = await requireOrganizationContext();
  if (!guard.ok) return guard.response;

  const { propertyId } = await params;
  const { data: property, error } = await guard.supabase
    .from('properties')
    .select(
      'id, title, property_type, listing_type, listing_intent, location, locality, bedrooms, price, media'
    )
    .eq('organization_id', guard.organizationId)
    .eq('id', propertyId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!property) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 });
  }

  try {
    const files = await listGoogleDriveImages();
    const image = selectGoogleDriveImage({
      files,
      requirements: {
        property_type: property.property_type,
        listing_type: property.listing_type,
        listing_intent: property.listing_intent,
        bedrooms: property.bedrooms,
      },
      matches: [
        {
          property_id: property.id,
          match_score: 100,
          matching_reasons: [],
          property: {
            ...property,
            media: Array.isArray(property.media) ? property.media : [],
          },
        },
      ],
    });

    if (!image) {
      return NextResponse.json(
        { error: 'Property image not found' },
        { status: 404 }
      );
    }

    const downloaded = await downloadGoogleDriveImage({
      fileId: image.file_id,
      resourceKey: image.resource_key,
      allowedFiles: files,
    });

    return new Response(new Uint8Array(downloaded.buffer), {
      headers: {
        'Content-Type': downloaded.mimeType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (driveError) {
    console.error(
      '[properties/image] Failed to load Google Drive image',
      driveError
    );
    return NextResponse.json(
      { error: 'Failed to load property image' },
      { status: 502 }
    );
  }
}
