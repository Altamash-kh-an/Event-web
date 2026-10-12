# How This Wedding Photo Album Was Built

## Run and Supabase checks

1. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_ADMIN_EMAIL`. Never commit `.env.local`; it is ignored by `.gitignore`.
2. Run `npm install`, then `npm run dev`. For production verification, run `npm run build` and optionally `npm run preview`.
3. Guests upload as the Supabase `anon` role through the publishable key. Uploads use `upsert: false` and the configured `Habibpur-shadi` folder inside the private `wedding-photos` bucket.
4. The repository contains the bucket MIME/25 MB settings and the admin-delete policy, but it does not contain the existing guest insert/select policies. In the Supabase Dashboard, verify that guest `INSERT` is granted only for bucket `wedding-photos` and the configured folder path, while public `SELECT` and guest `DELETE` remain disabled. Do not add a service-role key to this app.
5. If the live bucket does not match the app, set its size limit to 25 MB and allow `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `video/webm`, `video/mp4`, and `video/ogg`. Apply any policy change manually after reviewing existing policy names to avoid duplicates.

This project is a React + Vite wedding photo album built with a premium dark Muslim wedding design and Supabase Storage. The implementation was completed as follows:

1. The existing React + Vite application was inspected first so the original upload behavior and Supabase connection could remain working.

2. Supabase was connected through `src/lib/supabase.js` using the existing values from `.env.local`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_ADMIN_EMAIL`

   Only the publishable key is used in frontend code. No service-role or secret key is included in the project.

3. The existing private `wedding-photos` Supabase Storage bucket and guest upload policy were preserved. The project does not recreate or replace the existing guest policy.

4. Guest uploads are saved under the configurable folder `Habibpur-shadi`. The full path is created automatically by Supabase when the first file is uploaded:

   `wedding-photos/Habibpur-shadi/`

5. Guest upload functionality was kept working and includes:
   - Selecting one or multiple image files
   - Drag-and-drop support
   - Local image previews
   - Removing selected previews
   - Upload progress percentage
   - Success messages
   - Actual Supabase upload errors
   - Unique file names for every upload

6. The original visual layout was redesigned in `src/App.css` with a responsive premium wedding style:
   - Deep black and charcoal background
   - Warm ivory text
   - Muted gold accents
   - Subtle geometric background details
   - Responsive desktop and mobile layout
   - Arabic-supporting Amiri font
   - Right-to-left Arabic greeting and welcome text

7. All wedding-specific text is centralized in `src/siteConfig.js`. This includes:
   - Groom name
   - Bride name
   - English greeting
   - Arabic greeting
   - Arabic welcome text
   - Welcome line
   - Upload description
   - Guest upload folder
   - Wedding-wish label, optional text, placeholder, and max length (`weddingWish`)
   - Upload progress and success copy (`uploadMessages`)

   For another wedding, update only `src/siteConfig.js`. Existing uploaded photos are not moved when the folder name changes; the new folder is used for future uploads.

   Example: edit `siteConfig.weddingWish.label`, `siteConfig.weddingWish.placeholder`, or `siteConfig.uploadMessages.successMessage` for the next event. The camera/photo/video flow reads these values directly.

8. A separate `/admin` page was added without removing the admin access available from the guest page. Supabase email-password authentication is used for admin login and logout.

9. After admin login, the application recursively scans the private bucket. It lists photos from the root and every subfolder, creates temporary signed URLs, and displays the photos in a private gallery. Folder entries and `.emptyFolderPlaceholder` objects are ignored; only actual image files are shown.

10. `jszip` was added for the **Download All as ZIP** feature. The ZIP contains every image from the root and all subfolders while preserving the storage paths.

11. The **Empty Album** feature is restricted to the configured admin. It asks for confirmation, deletes images in batches from the root and all subfolders, then refreshes the gallery and shows zero remaining photos.

12. The delete policy is kept separate from the existing guest upload policy in `supabase/admin-delete-policy.sql`. It authorizes deletion through the Supabase JWT claim `app_metadata.is_admin = true`, rather than storing an admin email address in the policy file. After assigning this claim to the admin user, the user must sign out and sign in again to receive a refreshed JWT.

13. The following project files were added or updated for this implementation:
   - `src/App.jsx`: guest upload page, authentication, gallery, ZIP download, and Empty Album logic
   - `src/App.css`: main responsive wedding theme
   - `src/admin.css`: admin button styling
   - `src/siteConfig.js`: central wedding configuration
   - `src/lib/supabase.js`: Supabase client and bucket configuration
   - `supabase/storage-policies.sql`: bucket settings and allowed image formats
   - `supabase/admin-delete-policy.sql`: admin-only delete policy
   - `.env.example`: safe environment variable template
   - `.gitignore`: ignores local environment files, dependencies, builds, logs, and editor files

14. The project uses `@supabase/supabase-js` for authentication and Storage, and `jszip` for ZIP generation. The final application was verified with `npm run build`.
