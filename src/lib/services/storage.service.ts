/**
 * StorageService — manages file uploads to Supabase Storage and attachment records
 * in the `attachments` table.
 *
 * Responsibilities:
 *  - uploadFile: validate file size, download from Telegram, upload to Supabase Storage,
 *    return a signed URL
 *  - saveTextAttachment: insert an attachments row with type = 'text'
 *  - saveFileAttachment: insert an attachments row with type = 'file'
 *  - getAttachments: query attachments by task_id
 *
 * Requirements: 7.1, 7.2, 7.3, 7.6
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { getFile, downloadFile } from '@/lib/telegram/client';
import {
  Attachment,
  DatabaseError,
  FileTooLargeError,
  StorageError,
} from '@/types/index';
import type { AttachmentRow } from '@/lib/db/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed file size: 20 MB (Requirement 7.1) */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface StorageService {
  /**
   * Downloads a file from Telegram and uploads it to Supabase Storage.
   * Throws FileTooLargeError if fileSize > 20 MB.
   * Returns a signed URL for the uploaded file.
   */
  uploadFile(
    fileId: string,
    fileName: string,
    fileSize: number,
    userId: string,
    taskId: string
  ): Promise<string>;

  /** Inserts an attachments row with type = 'text'. */
  saveTextAttachment(taskId: string, text: string): Promise<Attachment>;

  /** Inserts an attachments row with type = 'file'. */
  saveFileAttachment(taskId: string, storagePath: string, fileName: string): Promise<Attachment>;

  /** Returns all attachments for a given task_id. */
  getAttachments(taskId: string): Promise<Attachment[]>;

  /** Regenerates a signed URL for a file attachment using its storage path. */
  regenerateSignedUrl(storagePath: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps a raw AttachmentRow to the domain Attachment type. */
function mapAttachmentRow(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    task_id: row.task_id,
    type: row.type,
    content: row.content,
    created_at: row.created_at,
  };
}

/** Returns the Supabase Storage bucket name from environment variables. */
function getBucketName(): string {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!bucket) {
    throw new StorageError('SUPABASE_STORAGE_BUCKET environment variable is not set');
  }
  return bucket;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const storageService: StorageService = {
  /**
   * Validates file size, downloads the file from Telegram CDN, uploads it to
   * Supabase Storage at path `{userId}/{taskId}/{timestamp}-{fileName}`, and
   * returns a signed URL valid for 1 hour.
   *
   * Throws FileTooLargeError if fileSize > 20 MB (Requirement 7.1).
   * Throws StorageError on upload failure.
   */
  async uploadFile(
    fileId: string,
    fileName: string,
    fileSize: number,
    userId: string,
    taskId: string
  ): Promise<string> {
    // Requirement 7.1: reject files larger than 20 MB
    if (fileSize > MAX_FILE_SIZE) {
      throw new FileTooLargeError();
    }

    const bucket = getBucketName();

    // Retrieve file_path from Telegram
    let filePath: string;
    try {
      const fileInfo = await getFile(fileId);
      if (!fileInfo.file_path) {
        throw new StorageError('Telegram did not return a file_path for the given file_id');
      }
      filePath = fileInfo.file_path;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      logger.error('StorageService.uploadFile: failed to get file info from Telegram', err);
      throw new StorageError('Failed to retrieve file information from Telegram');
    }

    // Download file bytes from Telegram CDN
    let fileBytes: Buffer;
    try {
      fileBytes = await downloadFile(filePath);
    } catch (err) {
      logger.error('StorageService.uploadFile: failed to download file from Telegram', err);
      throw new StorageError('Failed to download file from Telegram');
    }

    // Build storage path: {userId}/{taskId}/{timestamp}-{fileName}
    const timestamp = Date.now();
    const storagePath = `${userId}/${taskId}/${timestamp}-${fileName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, fileBytes, {
        contentType: 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      logger.error('StorageService.uploadFile: failed to upload to Supabase Storage', uploadError);
      throw new StorageError(`Failed to upload file to storage: ${uploadError.message}`);
    }

    // Generate a signed URL valid for 7 days (604800 seconds)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 604800);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      logger.error(
        'StorageService.uploadFile: failed to create signed URL',
        signedUrlError
      );
      throw new StorageError('Failed to generate signed URL for uploaded file');
    }

    return signedUrlData.signedUrl;
  },

  /**
   * Inserts an attachments row with type = 'text' and content = text.
   * Requirement 7.3
   */
  async saveTextAttachment(taskId: string, text: string): Promise<Attachment> {
    const { data, error } = await supabase
      .from('attachments')
      .insert({
        task_id: taskId,
        type: 'text',
        content: text,
      })
      .select('id, task_id, type, content, created_at')
      .single();

    if (error || !data) {
      logger.error('StorageService.saveTextAttachment: failed to insert attachment', error);
      throw new DatabaseError('Failed to save text attachment');
    }

    return mapAttachmentRow(data as AttachmentRow);
  },

  /**
   * Inserts an attachments row with type = 'file'.
   * Content is stored as "filename\nstoragePath" so the filename can be recovered
   * without a schema change. The storagePath is used to regenerate signed URLs on demand.
   * Requirement 7.2
   */
  async saveFileAttachment(taskId: string, storagePath: string, fileName: string): Promise<Attachment> {
    // Encode as "filename\nstoragePath" — newline is safe since filenames never contain \n
    const content = `${fileName}\n${storagePath}`;
    const { data, error } = await supabase
      .from('attachments')
      .insert({
        task_id: taskId,
        type: 'file',
        content,
      })
      .select('id, task_id, type, content, created_at')
      .single();

    if (error || !data) {
      logger.error('StorageService.saveFileAttachment: failed to insert attachment', error);
      throw new DatabaseError('Failed to save file attachment');
    }

    return mapAttachmentRow(data as AttachmentRow);
  },

  /**
   * Returns all attachments for the given task_id, ordered by created_at ascending.
   * Requirement 7.6
   */
  async getAttachments(taskId: string): Promise<Attachment[]> {
    const { data, error } = await supabase
      .from('attachments')
      .select('id, task_id, type, content, created_at')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('StorageService.getAttachments: failed to query attachments', error);
      throw new DatabaseError('Failed to get attachments');
    }

    return (data ?? []).map((row) => mapAttachmentRow(row as AttachmentRow));
  },

  /**
   * Regenerates a signed URL for a file attachment using its storage path.
   * The signed URL is valid for 7 days (604800 seconds).
   */
  async regenerateSignedUrl(storagePath: string): Promise<string> {
    const bucket = getBucketName();
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 604800);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      logger.error('StorageService.regenerateSignedUrl: failed to create signed URL', signedUrlError);
      throw new StorageError('Failed to regenerate signed URL');
    }

    return signedUrlData.signedUrl;
  },
};
