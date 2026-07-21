/**
 * File upload API for the employee mini app.
 * Accepts multipart/form-data with a file and taskId.
 * Uploads to Supabase Storage and saves an attachment record.
 *
 * POST { file: File, taskId: string, telegramId: number }
 */

import { supabase } from '@/lib/db/client';
import { storageService } from '@/lib/services/storage.service';
import { logger } from '@/lib/utils/logger';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

async function resolveUser(telegramId: number) {
  const { data, error } = await supabase
    .from('users')
    .select('id, role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const taskId = formData.get('taskId') as string | null;
    const telegramIdStr = formData.get('telegramId') as string | null;

    if (!file || !taskId || !telegramIdStr) {
      return Response.json({ error: 'file, taskId and telegramId required' }, { status: 400 });
    }

    const telegramId = Number(telegramIdStr);
    if (isNaN(telegramId)) {
      return Response.json({ error: 'invalid telegramId' }, { status: 400 });
    }

    const user = await resolveUser(telegramId);
    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 403 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: 'file_too_large', maxMb: 20 }, { status: 413 });
    }

    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (!bucket) {
      return Response.json({ error: 'Storage not configured' }, { status: 500 });
    }

    // Upload to Supabase Storage
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const fileName = file.name || `upload_${Date.now()}`;
    const storagePath = `${user.id}/${taskId}/${Date.now()}-${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      logger.error('Upload API: storage upload failed', uploadError);
      return Response.json({ error: 'Upload failed' }, { status: 500 });
    }

    // Save storage path instead of signed URL (will regenerate on demand)
    const attachment = await storageService.saveFileAttachment(taskId, storagePath, fileName);

    return Response.json({ ok: true, attachment });
  } catch (err) {
    logger.error('Upload API error', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
