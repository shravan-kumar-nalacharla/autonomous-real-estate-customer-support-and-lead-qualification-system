import { describe, expect, it } from 'vitest';
import {
  downloadGoogleDriveImage,
  listGoogleDriveImages,
  selectGoogleDriveImage,
} from './google-drive-images';

const files = [
  {
    id: 'apartment',
    name: 'demo-sale-apartment-modern-exterior-01.jpg',
    mimeType: 'image/jpeg',
  },
  {
    id: 'villa',
    name: 'demo-sale-villa-modern-exterior-01.jpg',
    mimeType: 'image/jpeg',
  },
];

describe('Google Drive image library', () => {
  it('selects a representative image from normalized filenames', () => {
    expect(
      selectGoogleDriveImage({
        files,
        requirements: { property_type: 'villa', listing_intent: 'buy' },
      })
    ).toMatchObject({ file_id: 'villa', kind: 'representative' });
  });

  it('prefers an image explicitly attached to a property', () => {
    expect(
      selectGoogleDriveImage({
        files,
        requirements: { property_type: 'villa' },
        matches: [
          {
            property_id: 'property-1',
            match_score: 90,
            matching_reasons: [],
            property: {
              id: 'property-1',
              title: 'Villa',
              property_type: 'villa',
              listing_type: 'sale',
              location: 'Hyderabad',
              locality: null,
              bedrooms: 4,
              price: 1,
              media: [{ drive_file_id: 'apartment' }],
            },
          },
        ],
      })
    ).toMatchObject({ file_id: 'apartment', kind: 'listing' });
  });

  it('lists only image files from the configured folder', async () => {
    const fetcher = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('q')).toContain('folder-1');
      return Response.json({
        files: [
          ...files,
          { id: 'doc', name: 'notes.txt', mimeType: 'text/plain' },
        ],
      });
    };

    await expect(
      listGoogleDriveImages({ apiKey: 'key', folderId: 'folder-1', fetcher })
    ).resolves.toHaveLength(2);
  });

  it('downloads only images contained in the configured folder', async () => {
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/drive/v3/files?')) return Response.json({ files });
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    };

    const result = await downloadGoogleDriveImage({
      fileId: 'villa',
      apiKey: 'key',
      folderId: 'folder-1',
      fetcher,
    });
    expect(result.filename).toBe('demo-sale-villa-modern-exterior-01.jpg');
    expect(result.buffer).toHaveLength(3);

    await expect(
      downloadGoogleDriveImage({
        fileId: 'not-in-folder',
        apiKey: 'key',
        folderId: 'folder-1',
        fetcher,
      })
    ).rejects.toThrow('not in the configured folder');
  });
});
