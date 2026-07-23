/**
 * Script to regenerate all attachment links in the database.
 * This script converts legacy signed URLs to storage paths and updates the database.
 * 
 * Usage: npx tsx scripts/regenerate-attachments.ts
 * 
 * Environment variables required:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - SUPABASE_STORAGE_BUCKET
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_STORAGE_BUCKET;

if (!supabaseUrl || !serviceRoleKey || !bucketName) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * Extract storage path from a legacy signed URL
 * Supabase signed URL format: /storage/v1/object/sign/{bucket}/{path}?token=...
 */
function extractStoragePath(signedUrl: string): string | null {
  try {
    const url = new URL(signedUrl);
    const pathParts = url.pathname.split('/');
    const objectIdx = pathParts.indexOf('object');
    if (objectIdx !== -1 && objectIdx + 2 < pathParts.length) {
      return pathParts.slice(objectIdx + 2).join('/');
    }
    return null;
  } catch (err) {
    console.error('Failed to parse URL:', signedUrl, err);
    return null;
  }
}

/**
 * Main function to regenerate attachment links
 */
async function regenerateAttachments() {
  console.log('Starting attachment link regeneration...');

  // Fetch all file attachments
  const { data: attachments, error } = await supabase
    .from('attachments')
    .select('id, content')
    .eq('type', 'file');

  if (error) {
    console.error('Failed to fetch attachments:', error);
    process.exit(1);
  }

  console.log(`Found ${attachments?.length || 0} file attachments`);

  if (!attachments || attachments.length === 0) {
    console.log('No file attachments to process');
    return;
  }

  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const attachment of attachments) {
    const { id, content } = attachment;

    // Check if content is already in the new format (filename\nstoragePath)
    if (content.includes('\n')) {
      console.log(`Skipping ${id} - already in new format`);
      skipped++;
      continue;
    }

    // Try to extract storage path from legacy signed URL
    const storagePath = extractStoragePath(content);
    if (!storagePath) {
      console.error(`Failed to extract storage path from ${id}: ${content}`);
      failed++;
      continue;
    }

    // Extract filename from the URL or use a default
    let fileName = 'file';
    try {
      const url = new URL(content);
      const pathParts = url.pathname.split('/');
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart) {
        // Remove timestamp prefix if present
        const match = lastPart.match(/^\d+-(.+)$/);
        fileName = match ? match[1] : lastPart;
      }
    } catch (err) {
      console.error('Failed to extract filename from URL', err);
    }

    // Update the attachment with the new format
    const newContent = `${fileName}\n${storagePath}`;
    const { error: updateError } = await supabase
      .from('attachments')
      .update({ content: newContent })
      .eq('id', id);

    if (updateError) {
      console.error(`Failed to update attachment ${id}:`, updateError);
      failed++;
    } else {
      console.log(`Updated attachment ${id}: ${fileName}`);
      updated++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total attachments: ${attachments.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (already new format): ${skipped}`);
  console.log(`Failed: ${failed}`);
}

regenerateAttachments()
  .then(() => {
    console.log('Attachment regeneration completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Attachment regeneration failed:', err);
    process.exit(1);
  });
