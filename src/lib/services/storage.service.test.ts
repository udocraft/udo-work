/**
 * Property-based tests for StorageService.
 *
 * // Feature: telegram-time-tracker, Property 7: Attachment storage round trip
 *
 * Validates: Requirements 7.2, 7.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Hoisted mock setup — vi.mock factories are hoisted to the top of the file,
// so any variables they reference must be declared with vi.hoisted().
// ---------------------------------------------------------------------------

const { mockFromFn } = vi.hoisted(() => {
  const mockFromFn = vi.fn();
  return { mockFromFn };
});

vi.mock('@/lib/db/client', () => ({
  supabase: {
    from: mockFromFn,
  },
}));

vi.mock('@/lib/telegram/client', () => ({
  getFile: vi.fn(),
  downloadFile: vi.fn(),
}));

import { storageService } from './storage.service';
import { DatabaseError } from '@/types/index';
import { getFile } from '@/lib/telegram/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a fake AttachmentRow that mirrors what Supabase would return. */
function buildAttachmentRow(taskId: string, type: 'file' | 'text', content: string) {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    task_id: taskId,
    type,
    content,
    created_at: new Date().toISOString(),
  };
}

/** Sets up the insert chain mock to return a single row. */
function setupInsertMock(row: ReturnType<typeof buildAttachmentRow>) {
  const singleFn = vi.fn().mockResolvedValue({ data: row, error: null });
  const selectFn = vi.fn().mockReturnValue({ single: singleFn });
  const insertFn = vi.fn().mockReturnValue({ select: selectFn });
  mockFromFn.mockReturnValue({ insert: insertFn });
}

/** Sets up the select chain mock to return an array of rows. */
function setupSelectMock(rows: ReturnType<typeof buildAttachmentRow>[]) {
  const orderFn = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eqFn = vi.fn().mockReturnValue({ order: orderFn });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  mockFromFn.mockReturnValue({ select: selectFn });
}

/** Sets up the insert chain mock to return an error. */
function setupInsertErrorMock() {
  const singleFn = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } });
  const selectFn = vi.fn().mockReturnValue({ single: singleFn });
  const insertFn = vi.fn().mockReturnValue({ select: selectFn });
  mockFromFn.mockReturnValue({ insert: insertFn });
}

// ---------------------------------------------------------------------------
// Property 7: Attachment Storage Round Trip
// ---------------------------------------------------------------------------

describe('StorageService — Property 7: Attachment Storage Round Trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Property 7a: Text attachment round trip
  // For any text content saved via saveTextAttachment, the returned Attachment
  // contains the exact same content and type = 'text'.
  // -------------------------------------------------------------------------
  it(
    'Property 7a: saveTextAttachment returns attachment with exact content and type=text',
    async () => {
      // Feature: telegram-time-tracker, Property 7: Attachment storage round trip
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.string({ minLength: 1, maxLength: 500 }),
          async (taskId, text) => {
            const row = buildAttachmentRow(taskId, 'text', text);
            setupInsertMock(row);

            const attachment = await storageService.saveTextAttachment(taskId, text);

            expect(attachment.task_id).toBe(taskId);
            expect(attachment.type).toBe('text');
            expect(attachment.content).toBe(text);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  // -------------------------------------------------------------------------
  // Property 7b: File attachment round trip
  // For any file storage path saved via saveFileAttachment, the returned Attachment
  // contains the exact storage path encoded as "filename\nstoragePath" and type = 'file'.
  // -------------------------------------------------------------------------
  it(
    'Property 7b: saveFileAttachment returns attachment with storage path encoded as filename\\npath and type=file',
    async () => {
      // Feature: telegram-time-tracker, Property 7: Attachment storage round trip
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.string({ minLength: 1, maxLength: 100 }), // storage path
          fc.string({ minLength: 1, maxLength: 100 }), // filename
          async (taskId, storagePath, fileName) => {
            const content = `${fileName}\n${storagePath}`;
            const row = buildAttachmentRow(taskId, 'file', content);
            setupInsertMock(row);

            const attachment = await storageService.saveFileAttachment(taskId, storagePath, fileName);

            expect(attachment.task_id).toBe(taskId);
            expect(attachment.type).toBe('file');
            expect(attachment.content).toBe(content);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  // -------------------------------------------------------------------------
  // Property 7c: getAttachments returns all stored attachments for a task_id
  // For any collection of attachments saved for a task_id, querying by that
  // task_id returns records with the exact content that was stored.
  // -------------------------------------------------------------------------
  it(
    'Property 7c: getAttachments returns all attachments with exact content for a task_id',
    async () => {
      // Feature: telegram-time-tracker, Property 7: Attachment storage round trip
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.array(
            fc.record({
              type: fc.constantFrom('file' as const, 'text' as const),
              content: fc.string({ minLength: 1, maxLength: 200 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          async (taskId, attachmentInputs) => {
            const rows = attachmentInputs.map((input, i) => ({
              id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
              task_id: taskId,
              type: input.type,
              content: input.content,
              created_at: new Date().toISOString(),
            }));

            setupSelectMock(rows);

            const attachments = await storageService.getAttachments(taskId);

            expect(attachments).toHaveLength(rows.length);
            for (let i = 0; i < rows.length; i++) {
              expect(attachments[i].task_id).toBe(taskId);
              expect(attachments[i].type).toBe(rows[i].type);
              expect(attachments[i].content).toBe(rows[i].content);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  // -------------------------------------------------------------------------
  // Unit test: FileTooLargeError is thrown when fileSize > 20 MB
  // -------------------------------------------------------------------------
  it('uploadFile throws FileTooLargeError when fileSize exceeds 20 MB', async () => {
    const MAX = 20 * 1024 * 1024;
    await expect(
      storageService.uploadFile('file-id', 'test.pdf', MAX + 1, 'user-id', 'task-id')
    ).rejects.toThrow('File exceeds the 20 MB size limit');
  });

  it('uploadFile does not throw FileTooLargeError when fileSize equals 20 MB', async () => {
    const MAX = 20 * 1024 * 1024;
    vi.mocked(getFile).mockRejectedValue(new Error('Telegram unavailable'));

    // Should throw StorageError (Telegram unavailable), NOT FileTooLargeError
    await expect(
      storageService.uploadFile('file-id', 'test.pdf', MAX, 'user-id', 'task-id')
    ).rejects.not.toThrow('File exceeds the 20 MB size limit');
  });

  // -------------------------------------------------------------------------
  // Unit test: DatabaseError is thrown on DB failure
  // -------------------------------------------------------------------------
  it('saveTextAttachment throws DatabaseError when DB insert fails', async () => {
    setupInsertErrorMock();

    await expect(
      storageService.saveTextAttachment('task-id', 'some text')
    ).rejects.toThrow(DatabaseError);
  });

  it('saveFileAttachment throws DatabaseError when DB insert fails', async () => {
    setupInsertErrorMock();

    await expect(
      storageService.saveFileAttachment('task-id', 'user-id/task-id/123-file.pdf', 'file.pdf')
    ).rejects.toThrow(DatabaseError);
  });
});
