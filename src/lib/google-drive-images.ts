import type { ParsedLeadRequirements } from './real-estate/types';
import type { PropertyMatch } from './real-estate/property-matching';

export const DEFAULT_REAL_ESTATE_IMAGE_FOLDER_ID =
  '1u5IB_CugfwodO3ANLfYmBRSleYPIaSSk';

export interface GoogleDriveImage {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  resourceKey?: string;
}

export interface MatchedDriveImage {
  file_id: string;
  filename: string;
  mime_type: string;
  resource_key: string | null;
  kind: 'listing' | 'representative';
}

interface DriveListResponse {
  files?: GoogleDriveImage[];
  error?: { message?: string };
}

interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export async function listGoogleDriveImages(
  args: {
    apiKey?: string;
    folderId?: string;
    fetcher?: FetchLike;
  } = {}
): Promise<GoogleDriveImage[]> {
  const apiKey = args.apiKey ?? process.env.GOOGLE_DRIVE_API_KEY;
  if (!apiKey) return [];

  const folderId =
    args.folderId ??
    process.env.GOOGLE_DRIVE_IMAGE_FOLDER_ID ??
    DEFAULT_REAL_ESTATE_IMAGE_FOLDER_ID;
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
    fields: 'files(id,name,mimeType,size,resourceKey)',
    orderBy: 'name',
    pageSize: '1000',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    key: apiKey,
  });
  const response = await (args.fetcher ?? fetch)(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { signal: AbortSignal.timeout(15_000) }
  );
  const payload = (await response
    .json()
    .catch(() => ({}))) as DriveListResponse;
  if (!response.ok) {
    throw new Error(
      payload.error?.message || `Google Drive returned HTTP ${response.status}`
    );
  }

  return (payload.files ?? []).filter(
    (file) => file.id && file.name && file.mimeType.startsWith('image/')
  );
}

export function selectGoogleDriveImage(args: {
  files: GoogleDriveImage[];
  requirements: ParsedLeadRequirements;
  matches?: PropertyMatch[];
}): MatchedDriveImage | null {
  const listingReference = referencedListingImage(
    args.matches ?? [],
    args.files
  );
  if (listingReference) return toMatchedImage(listingReference, 'listing');

  const firstProperty = args.matches?.[0]?.property;
  const propertyType = normalize(
    args.requirements.property_type ?? firstProperty?.property_type ?? ''
  );
  const listingIntent = normalize(
    args.requirements.listing_intent ??
      firstProperty?.listing_intent ??
      firstProperty?.listing_type ??
      ''
  );
  const bedrooms =
    args.requirements.bedrooms ?? args.requirements.bedroom_count;
  const aliases = propertyAliases(propertyType);

  const ranked = args.files
    .map((file) => {
      const name = normalize(file.name);
      let score = aliases.reduce(
        (total, alias) => total + (name.includes(alias) ? 10 : 0),
        0
      );
      if (listingIntent && name.includes(normalizeListingIntent(listingIntent)))
        score += 3;
      if (bedrooms && name.includes(`${bedrooms}bhk`)) score += 6;
      if (name.includes('exterior')) score += 1;
      return { file, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name)
    );

  return ranked[0] ? toMatchedImage(ranked[0].file, 'representative') : null;
}

export async function findGoogleDriveImage(args: {
  requirements: ParsedLeadRequirements;
  matches?: PropertyMatch[];
  apiKey?: string;
  folderId?: string;
  fetcher?: FetchLike;
}): Promise<MatchedDriveImage | null> {
  const files = await listGoogleDriveImages(args);
  return selectGoogleDriveImage({
    files,
    requirements: args.requirements,
    matches: args.matches,
  });
}

export async function downloadGoogleDriveImage(args: {
  fileId: string;
  resourceKey?: string | null;
  apiKey?: string;
  folderId?: string;
  fetcher?: FetchLike;
}) {
  const apiKey = args.apiKey ?? process.env.GOOGLE_DRIVE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_DRIVE_API_KEY is not configured');

  const files = await listGoogleDriveImages({
    apiKey,
    folderId: args.folderId,
    fetcher: args.fetcher,
  });
  const allowedFile = files.find((file) => file.id === args.fileId);
  if (!allowedFile)
    throw new Error('Google Drive image is not in the configured folder');

  const headers = new Headers();
  const resourceKey = args.resourceKey ?? allowedFile.resourceKey;
  if (resourceKey) {
    headers.set(
      'X-Goog-Drive-Resource-Keys',
      `${allowedFile.id}/${resourceKey}`
    );
  }
  const response = await (args.fetcher ?? fetch)(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(allowedFile.id)}?alt=media&key=${encodeURIComponent(apiKey)}`,
    { headers, signal: AbortSignal.timeout(20_000) }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to download Google Drive image: HTTP ${response.status}`
    );
  }
  const mimeType = (
    response.headers.get('content-type') ?? allowedFile.mimeType
  )
    .split(';')[0]
    .trim();
  if (!mimeType.startsWith('image/')) {
    throw new Error(`Google Drive file is not an image (got "${mimeType}")`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('Google Drive returned an empty image');
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('Google Drive image exceeds the 5 MB WhatsApp image limit');
  }

  return { buffer, filename: allowedFile.name, mimeType };
}

function referencedListingImage(
  matches: PropertyMatch[],
  files: GoogleDriveImage[]
) {
  for (const match of matches) {
    for (const media of match.property?.media ?? []) {
      if (typeof media === 'string') {
        const byName = files.find((file) => file.name === media);
        if (byName) return byName;
        continue;
      }
      const fileId = String(media.drive_file_id ?? '').trim();
      const filename = String(media.filename ?? '').trim();
      const found = files.find(
        (file) =>
          (fileId && file.id === fileId) || (filename && file.name === filename)
      );
      if (found) return found;
    }
  }
  return null;
}

function propertyAliases(propertyType: string) {
  if (['apartment', 'flat', 'highrise'].includes(propertyType)) {
    return [
      'apartment',
      'flat',
      'highrise',
      'livingroom',
      'bedroom',
      'kitchen',
    ];
  }
  if (['villa', 'independenthouse', 'house'].includes(propertyType)) {
    return [
      'villa',
      'independenthouse',
      'house',
      'livingroom',
      'bedroom',
      'kitchen',
    ];
  }
  if (['plot', 'land', 'agriculturalland'].includes(propertyType)) {
    return ['plot', 'land', 'roadaccess'];
  }
  if (['office', 'commercialoffice'].includes(propertyType)) return ['office'];
  if (['showroom', 'commercialshop', 'shop'].includes(propertyType)) {
    return ['showroom', 'shop', 'retail'];
  }
  if (propertyType === 'warehouse') return ['warehouse'];
  return propertyType ? [propertyType] : [];
}

function normalizeListingIntent(value: string) {
  if (value === 'buy') return 'sale';
  if (value === 'rent') return 'lease';
  return value;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toMatchedImage(
  file: GoogleDriveImage,
  kind: MatchedDriveImage['kind']
): MatchedDriveImage {
  return {
    file_id: file.id,
    filename: file.name,
    mime_type: file.mimeType,
    resource_key: file.resourceKey ?? null,
    kind,
  };
}
