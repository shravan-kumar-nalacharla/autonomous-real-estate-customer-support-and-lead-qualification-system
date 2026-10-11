# Google Drive property images

The real-estate agent can select an image from the shared Google Drive folder,
download it on the server, upload it to WhatsApp, and send it with the matched
property summary. The Google API key is never sent to n8n or the browser.

## One-time production setup

1. In Google Cloud, enable **Google Drive API** and create an API key restricted
   to that API.
2. In Google Drive, share folder
   `1u5IB_CugfwodO3ANLfYmBRSleYPIaSSk` as **Anyone with the link - Viewer**.
3. Add these environment variables to the application host and redeploy:

   ```text
   GOOGLE_DRIVE_API_KEY=<restricted Google API key>
   GOOGLE_DRIVE_IMAGE_FOLDER_ID=1u5IB_CugfwodO3ANLfYmBRSleYPIaSSk
   ```

4. Apply Supabase migration
   `20261011010000_appointment_request_upsert.sql`.
5. Import `n8n/Real Estate AI Agent - Production v16.json`, deactivate v15,
   and activate only v16.

## Image naming

Keep all images directly inside the configured folder. Include the property type
and useful matching terms in lowercase filenames, for example:

```text
apartment-sale-2bhk-living-room-01.jpg
apartment-rent-3bhk-bedroom-01.jpg
villa-sale-exterior-01.jpg
plot-sale-road-access-01.jpg
office-lease-interior-01.jpg
showroom-lease-interior-01.jpg
warehouse-rent-exterior-01.jpg
```

For a specific listing, add its Drive file ID or exact filename to the
property's `media` array. Listing-specific media wins; otherwise the agent picks
a representative image based on property type, listing intent, and bedroom
count.

## Smoke test

1. Send `Hi` and confirm the three WhatsApp reply buttons appear.
2. Choose **Find Property**, then **Buy** or **Rent** and provide property type,
   location, budget, and bedrooms.
3. Confirm the reply includes a matching image and property summary.
4. Ask to book a site visit and provide a date/time.
5. Confirm one request appears at `/appointments` with status `requested` and a
   high-priority follow-up task exists for human confirmation.
