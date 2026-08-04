-- Fully Free Image Generation — Step 2
--
-- image-generator.ts's uploadToStorage() has referenced an 'article-images'
-- bucket since it was written, but the bucket itself was never created — so
-- every upload has been silently failing (caught by .catch(() => '')) and
-- falling back to the source image's own URL (pollinations.ai etc.) instead
-- of permanent Supabase Storage hosting. This creates the bucket the code
-- already assumes exists.

INSERT INTO storage.buckets (id, name, public)
VALUES ('article-images', 'article-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can upload article images" ON storage.objects;
CREATE POLICY "Authenticated users can upload article images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'article-images' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role can upload article images" ON storage.objects;
CREATE POLICY "Service role can upload article images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'article-images' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS "Public read access for article images" ON storage.objects;
CREATE POLICY "Public read access for article images"
ON storage.objects FOR SELECT
USING (bucket_id = 'article-images');
