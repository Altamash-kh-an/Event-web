-- The upload and admin-view policies already exist in Supabase.
-- Do not recreate them here.

update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = ARRAY[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
      'video/webm', 'video/mp4', 'video/ogg'
    ]
where id = 'wedding-photos';
