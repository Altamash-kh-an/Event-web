-- The upload and admin-view policies already exist in Supabase.
-- Do not recreate them here.

update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = ARRAY[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
    ]
where id = 'wedding-photos';
