import type { ParsedLeadRequirements } from './real-estate/types';
import type { PropertyMatch } from './real-estate/property-matching';

export const DEFAULT_REAL_ESTATE_IMAGE_FOLDER_ID =
  '1u5IB_CugfwodO3ANLfYmBRSleYPIaSSk';

const DEFAULT_REAL_ESTATE_IMAGES: GoogleDriveImage[] = [
  {
    id: '1mgt4ftz7-B0IlAyecugxKj-hOVDS3_o9',
    name: 'demo-sale-villa-modern-exterior-01.jpg',
    mimeType: 'image/jpeg',
  },
  {
    id: '1gHLUHtSKaovzV0mKyhKdKvccxVfugiAi',
    name: 'demo-sale-plot-road-access-01.jpg',
    mimeType: 'image/jpeg',
  },
  {
    id: '1BSefTRo1WeQQRaXAkACZHhDQwbPx-h0v',
    name: 'demo-sale-highrise-hyderabad-exterior-01.jpg',
    mimeType: 'image/jpeg',
  },
  {
    id: '1lBWwT9bFUo065lpRryqwBOWZJpkZB-8K',
    name: 'demo-sale-apartment-3bhk-interior-01.jpg',
    mimeType: 'image/jpeg',
  },
  {
    id: '1kp1lAFvMHRnlZGaDlKkyIbxNbwz_6CL4',
    name: 'demo-sale-apartment-2bhk-bedroom-01.jpg',
    mimeType: 'image/jpeg',
  },
  {
    id: '1MYbo8i90XcqCOWVfVONFm7X7MvYKGd1V',
    name: 'demo-sale-agricultural-land-01.jpg',
    mimeType: 'image/jpeg',
  },
  {
    id: '1WOmRJ6GHqomhzycwCRlw0wFewe7iFWLA',
    name: 'demo-lease-warehouse-modern-exterior-01.jpg',
    mimeType: 'image/jpeg',
  },
  {
    id: '1r1-56ZCQvXSVQrkM-H8AyvpUWMnNhq6y',
    name: 'demo-lease-showroom-modern-interior-01.jpg',
    mimeType: 'image/jpeg',
  },
  {
    id: '1OjFmAAEB7ny4b_-ScKe6zPBmOwplOIqv',
    name: 'demo-lease-office-modern-interior-01.jpg',
    mimeType: 'image/jpeg',
  },
  {
    id: '1noYyBDocdpXAU-YfsgNweB6QrQ6B73-m',
    name: 'demo-lease-commercial-shop-exterior-01.jpg',
    mimeType: 'image/jpeg',
  },
];

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
  const folderId =
    args.folderId ??
    process.env.GOOGLE_DRIVE_IMAGE_FOLDER_ID ??
    DEFAULT_REAL_ESTATE_IMAGE_FOLDER_ID;
  if (!apiKey) {
    return folderId === DEFAULT_REAL_ESTATE_IMAGE_FOLDER_ID
      ? DEFAULT_REAL_ESTATE_IMAGES
      : [];
  }
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
    if (folderId === DEFAULT_REAL_ESTATE_IMAGE_FOLDER_ID) {
      return DEFAULT_REAL_ESTATE_IMAGES;
    }
    throw new Error(
      payload.error?.message || `Google Drive returned HTTP ${response.status}`
    );
  }

  const files = (payload.files ?? []).filter(
    (file) => file.id && file.name && file.mimeType.startsWith('image/')
  );
  return files.length || folderId !== DEFAULT_REAL_ESTATE_IMAGE_FOLDER_ID
    ? files
    : DEFAULT_REAL_ESTATE_IMAGES;
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
    firstProperty?.property_type ?? args.requirements.property_type ?? ''
  );
  const listingIntent = normalize(
    firstProperty?.listing_intent ??
      firstProperty?.listing_type ??
      args.requirements.listing_intent ??
      ''
  );
  const bedrooms =
    firstProperty?.bedrooms ??
    args.requirements.bedrooms ??
    args.requirements.bedroom_count;
  const aliases = propertyAliases(propertyType);
  if (!aliases.length && bedrooms) {
    aliases.push('bedroom', 'livingroom', 'kitchen');
  }

  const ranked = args.files
    .map((file) => {
      const name = normalize(file.name);
      let score = aliases.reduce(
        (total, alias) => total + (name.includes(alias) ? 10 : 0),
        0
      );
      if (listingIntent && name.includes(normalizeListingIntent(listingIntent)))
        score += 3;
      if (
        bedrooms &&
        (name.includes(`${bedrooms}bhk`) || name.includes(`bedroom${bedrooms}`))
      )
        score += 30;
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
  allowedFiles?: GoogleDriveImage[];
  fetcher?: FetchLike;
}) {
  const files =
    args.allowedFiles ??
    (await listGoogleDriveImages({
      apiKey: args.apiKey,
      folderId: args.folderId,
      fetcher: args.fetcher,
    }));
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
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(allowedFile.id)}`,
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
