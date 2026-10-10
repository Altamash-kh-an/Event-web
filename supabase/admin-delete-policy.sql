-- Run this separately in Supabase SQL Editor.
-- It does not change the existing guest upload policy.
-- Set {"is_admin": true} in this user's auth.users.raw_app_meta_data once
-- (using the Supabase SQL Editor or an admin backend). The policy intentionally
-- does not contain an email address.
drop policy if exists "Admin can delete wedding photos" on storage.objects;

create policy "Admin can delete wedding photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'wedding-photos'
  and coalesce(auth.jwt() -> 'app_metadata' ->> 'is_admin', 'false') = 'true'
);
