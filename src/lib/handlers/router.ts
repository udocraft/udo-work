/**
 * Router (state machine) for the Telegram Time Tracker bot.
 *
 * Dispatches incoming Telegram updates to the correct handler based on:
 *  - callback_data prefix (action:, project:, period:, deliverable:, employee:, task:, filter:, page:)
 *  - session state for text messages (awaiting_project_name, awaiting_task_name, awaiting_deliverable)
 *  - /start command
 *
 * Enforces role-based access control before any handler is called.
 *
 * Requirements: 1.5, 12.2, 15.2, 15.3
 */

import * as telegramClient from '@/lib/telegram/client';
import * as employeeHandlers from '@/lib/handlers/employee.handlers';
import * as adminHandlers from '@/lib/handlers/admin.handlers';
import { sessionService } from '@/lib/services/session.service';
import { taskService } from '@/lib/services/task.service';
import { MESSAGES } from '@/lib/messages';
import { logger } from '@/lib/utils/logger';
import { EMPLOYEE_MAIN_MENU, ADMIN_MAIN_MENU, EMPLOYEE_REPLY_KEYBOARD, ADMIN_REPLY_KEYBOARD, buildAdminMainMenu, buildEmployeeMainMenu, buildContextualEmployeeMenu } from '@/lib/telegram/keyboards';
import type { TelegramUpdate, HandlerContext } from '@/types/index';

// ---------------------------------------------------------------------------
// Role-based access control sets
// ---------------------------------------------------------------------------

/** callback_data action values that only employees may use. */
const EMPLOYEE_ONLY_ACTIONS = new Set([
  'start_task',
  'recent_tasks',
  'pause_task',
  'resume_task',
  'complete_task',
  'my_activity',
]);

/** callback_data action values that only admins may use. */
const ADMIN_ONLY_ACTIONS = new Set([
  'create_project',
  'deactivate_project',
  'employees',
  'tasks_logs',
  'manage_admins',
  'add_admin',
  'add_employee',
  'remove_admin',
  'remove_employee',
  'invite_to_project',
]);

// ---------------------------------------------------------------------------
// Reply keyboard text → action mapping
// ---------------------------------------------------------------------------

/** Maps reply keyboard button text to the equivalent callback action for employees. */
const EMPLOYEE_TEXT_ACTIONS: Record<string, string> = {
  // Current keyboard labels
  '🚀 Почати задачу': 'start_task',
  '⏸️ Пауза': 'pause_task',
  '▶️ Відновити': 'resume_task',
  '✅ Завершити': 'complete_task',
  '🔁 Повторити задачу': 'recent_tasks',
  '📊 Моя активність': 'my_activity',
  // Legacy labels (kept for backward compatibility with existing sessions)
  '▶ Почати задачу': 'start_task',
  '⏸ Пауза': 'pause_task',
  '▶ Відновити': 'resume_task',
  '✓ Завершити задачу': 'complete_task',
  '▶️ Почати задачу': 'start_task',
  '✅ Завершити задачу': 'complete_task',
};

/** Maps reply keyboard button text to the equivalent callback action for admins. */
const ADMIN_TEXT_ACTIONS: Record<string, string> = {
  // Current keyboard labels
  '➕ Створити проєкт': 'create_project',
  '🔴 Деактивувати проєкт': 'deactivate_project',
  '👥 Команда': 'employees',
  '📋 Задачі та логи': 'tasks_logs',
  '⚙️ Управління користувачами': 'manage_admins',
  '🔗 Запросити до проєкту': 'invite_to_project',
  // Legacy labels (kept for backward compatibility)
  '+ Створити проєкт': 'create_project',
  '○ Деактивувати проєкт': 'deactivate_project',
  '⚙ Управління користувачами': 'manage_admins',
  '📁 Створити проєкт': 'create_project',
  '🚫 Деактивувати проєкт': 'deactivate_project',
  '👥 Співробітники': 'employees',
  '🔑 Управління користувачами': 'manage_admins',
};

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

/**
 * Routes a Telegram update to the appropriate handler.
 * This function is a pure dispatcher — no business logic lives here.
 *
 * Requirements: 1.5, 12.2, 15.2, 15.3
 */
export async function route(
  update: TelegramUpdate,
  ctx: HandlerContext,
): Promise<void> {
  const { user, session, chatId } = ctx;

  // -------------------------------------------------------------------------
  // Callback query handling
  // -------------------------------------------------------------------------
  if (update.callback_query) {
    const callbackQuery = update.callback_query;
    const callbackQueryId = callbackQuery.id;
    const data = callbackQuery.data ?? '';
    const messageId = callbackQuery.message?.message_id;

    // Pass messageId so handlers can edit the message in place
    const ctxWithMessage: HandlerContext = { ...ctx, messageId };

    try {
      await handleCallbackData(data, ctxWithMessage);
    } finally {
      // Always answer the callback query to dismiss the loading indicator
      telegramClient
        .answerCallbackQuery(callbackQueryId)
        .catch((err) => logger.error('router: answerCallbackQuery failed', err));
    }

    return;
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------
  if (update.message) {
    const message = update.message;
    const text = message.text ?? '';

    // /start command — show role-appropriate main menu (Req 1.5)
    if (text === '/start') {
      if (user.role === 'admin') {
        await telegramClient.sendMessage(chatId, MESSAGES.MAIN_MENU_ADMIN, {
          reply_markup: buildAdminMainMenu(user.telegram_id),
        });
      } else {
        // Build contextual menu based on current task state
        const activeTask = await taskService.getActiveTask(user.id).catch(() => null);
        const taskStatus = activeTask ? (activeTask.status as 'in_progress' | 'paused') : null;
        await telegramClient.sendMessage(chatId, MESSAGES.MAIN_MENU_EMPLOYEE, {
          reply_markup: buildContextualEmployeeMenu(taskStatus, user.telegram_id),
        });
      }
      return;
    }

    // State-based text dispatch (Req 12.2)
    const state = session.state;

    // -----------------------------------------------------------------------
    // Reply keyboard button text → action dispatch (any state)
    // The persistent reply keyboard must always work, even mid-flow.
    // For employees: pause/resume/complete/start always interrupt the current
    // state so the user is never stuck. The session is reset by the handler.
    // -----------------------------------------------------------------------
    if (user.role === 'employee') {
      const action = EMPLOYEE_TEXT_ACTIONS[text];
      if (action) {
        // Reset session first so the handler sees a clean state
        await sessionService.resetSession(user.id).catch(() => {});
        await handleCallbackData(`action:${action}`, { ...ctx, session: { ...ctx.session, state: null, context: null } });
        return;
      }
    } else if (user.role === 'admin') {
      // Admin reply keyboard only fires in idle state to avoid interrupting flows
      if (!state || state === 'idle') {
        const action = ADMIN_TEXT_ACTIONS[text];
        if (action) {
          await handleCallbackData(`action:${action}`, ctx);
          return;
        }
      }
    }

    if (state === 'awaiting_project_name') {
      // Admin-only state
      if (user.role !== 'admin') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      await adminHandlers.handleProjectNameInput(ctx, text);
      return;
    }

    if (state === 'awaiting_new_admin_id') {
      if (user.role !== 'admin') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      await adminHandlers.handleNewAdminIdInput(ctx, message);
      return;
    }

    if (state === 'awaiting_new_employee_id') {
      if (user.role !== 'admin') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      await adminHandlers.handleNewEmployeeIdInput(ctx, message);
      return;
    }

    if (state === 'awaiting_new_user_name') {
      if (user.role !== 'admin') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      if (text === '/skip') {
        await sessionService.resetSession(user.id);
        await telegramClient.sendMessage(chatId, '✅ Користувача додано без імені.', { reply_markup: ADMIN_MAIN_MENU });
        return;
      }
      await adminHandlers.handleNewUserNameInput(ctx, text);
      return;
    }

    if (state === 'awaiting_edit_employee_name') {
      if (user.role !== 'admin') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      await adminHandlers.handleEditEmployeeNameInput(ctx, text);
      return;
    }

    if (state === 'awaiting_edit_hourly_rate') {
      if (user.role !== 'admin') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      await adminHandlers.handleEditEmployeeRateInput(ctx, text);
      return;
    }

    if (state === 'awaiting_task_name') {
      // Employee-only state
      if (user.role !== 'employee') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      await employeeHandlers.handleTaskNameInput(ctx, text);
      return;
    }

    if (state === 'awaiting_task_comment') {
      if (user.role !== 'employee') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      // If the user sends a file/photo directly (skipping the comment step),
      // treat it as an implicit /skip of the comment and go straight to deliverable.
      if (message.document || (message.photo && message.photo.length > 0)) {
        await employeeHandlers.handleTaskCommentInput(ctx, '/skip');
        // Re-fetch session so the state is now awaiting_deliverable
        const updatedSession = await sessionService.getSession(user.id);
        await employeeHandlers.handleDeliverableInput({ ...ctx, session: updatedSession }, message);
        return;
      }
      // /skip in comment state → go straight to file prompt
      await employeeHandlers.handleTaskCommentInput(ctx, text);
      return;
    }

    if (state === 'awaiting_deliverable_choice') {
      // Legacy state — treat any text as "finish" to avoid getting stuck
      if (user.role !== 'employee') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      await employeeHandlers.handleAddMoreOrFinish(ctx, 'finish');
      return;
    }

    if (state === 'awaiting_deliverable') {
      if (user.role !== 'employee') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      // /skip in deliverable state → finalise task without more files
      if (text === '/skip') {
        await employeeHandlers.handleAddMoreOrFinish(ctx, 'finish');
        return;
      }
      await employeeHandlers.handleDeliverableInput(ctx, message);
      return;
    }

    // Unknown command or message in idle state — show main menu
    if (user.role === 'admin') {
      await telegramClient.sendMessage(chatId, MESSAGES.MAIN_MENU_ADMIN, {
        reply_markup: buildAdminMainMenu(user.telegram_id),
      });
    } else {
      const activeTask = await taskService.getActiveTask(user.id).catch(() => null);
      const taskStatus = activeTask ? (activeTask.status as 'in_progress' | 'paused') : null;
      await telegramClient.sendMessage(chatId, MESSAGES.MAIN_MENU_EMPLOYEE, {
        reply_markup: buildContextualEmployeeMenu(taskStatus, user.telegram_id),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Callback data dispatcher
// ---------------------------------------------------------------------------

/**
 * Parses callback_data and dispatches to the correct handler.
 * Enforces role-based access control before calling any handler.
 */
async function handleCallbackData(
  data: string,
  ctx: HandlerContext,
): Promise<void> {
  const { user, session, chatId } = ctx;

  // -------------------------------------------------------------------------
  // action: prefix
  // -------------------------------------------------------------------------
  if (data.startsWith('action:')) {
    const action = data.slice('action:'.length);

    // back_to_main works for any role
    if (action === 'back_to_main') {
      if (user.role === 'admin') {
        const text = MESSAGES.MAIN_MENU_ADMIN;
        const keyboard = buildAdminMainMenu(user.telegram_id);
        if (ctx.messageId) {
          await telegramClient.editMessageText(chatId, ctx.messageId, text, { reply_markup: keyboard });
        } else {
          await telegramClient.sendMessage(chatId, text, { reply_markup: keyboard });
        }
      } else {
        const activeTask = await taskService.getActiveTask(user.id).catch(() => null);
        const taskStatus = activeTask ? (activeTask.status as 'in_progress' | 'paused') : null;
        const keyboard = buildContextualEmployeeMenu(taskStatus, user.telegram_id);
        if (ctx.messageId) {
          await telegramClient.editMessageText(chatId, ctx.messageId, MESSAGES.MAIN_MENU_EMPLOYEE, { reply_markup: keyboard });
        } else {
          await telegramClient.sendMessage(chatId, MESSAGES.MAIN_MENU_EMPLOYEE, { reply_markup: keyboard });
        }
      }
      await sessionService.resetSession(user.id).catch(() => {});
      return;
    }

    // Employee-only actions (Req 15.2)
    if (EMPLOYEE_ONLY_ACTIONS.has(action)) {
      if (user.role !== 'employee') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }

      switch (action) {
        case 'start_task':
          await employeeHandlers.handleStartTask(ctx);
          break;
        case 'recent_tasks':
          await employeeHandlers.handleRecentTasks(ctx);
          break;
        case 'pause_task':
          await employeeHandlers.handlePauseTask(ctx);
          break;
        case 'resume_task':
          await employeeHandlers.handleResumeTask(ctx);
          break;
        case 'complete_task':
          await employeeHandlers.handleCompleteTask(ctx);
          break;
        case 'my_activity':
          await employeeHandlers.handleMyActivity(ctx);
          break;
        default:
          logger.warn('router: unhandled employee action', action);
      }
      return;
    }

    // Admin-only actions (Req 15.3)
    if (ADMIN_ONLY_ACTIONS.has(action)) {
      if (user.role !== 'admin') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }

      switch (action) {
        case 'create_project':
          await adminHandlers.handleCreateProject(ctx);
          break;
        case 'deactivate_project':
          await adminHandlers.handleDeactivateProject(ctx);
          break;
        case 'employees':
          await adminHandlers.handleEmployees(ctx);
          break;
        case 'tasks_logs':
          await adminHandlers.handleTasksLogs(ctx);
          break;
        case 'manage_admins':
          await adminHandlers.handleManageAdmins(ctx);
          break;
        case 'add_admin':
          await adminHandlers.handleAddAdmin(ctx);
          break;
        case 'add_employee':
          await adminHandlers.handleAddEmployee(ctx);
          break;
        case 'remove_admin':
          await adminHandlers.handleRemoveAdmin(ctx);
          break;
        case 'remove_employee':
          await adminHandlers.handleRemoveEmployee(ctx);
          break;
        case 'invite_to_project':
          await adminHandlers.handleInviteToProject(ctx);
          break;
        default:
          logger.warn('router: unhandled admin action', action);
      }
      return;
    }

    // back_to_main works for any role — handled above, so this is a fallthrough
    logger.warn('router: unknown action', action);
    return;
  }

  // -------------------------------------------------------------------------
  // project:{id} prefix
  // -------------------------------------------------------------------------
  if (data.startsWith('project:')) {
    const projectId = data.slice('project:'.length);

    // Routing depends on session state:
    // - awaiting_task_name → employee flow (project selection for task start)
    // - otherwise → admin deactivation flow
    if (session.state === 'awaiting_task_name') {
      if (user.role !== 'employee') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      await employeeHandlers.handleProjectSelected(ctx, projectId);
    } else {
      if (user.role !== 'admin') {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
        return;
      }
      await adminHandlers.handleDeactivateProjectConfirm(ctx, projectId);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // period:{today|week} prefix — employee only
  // -------------------------------------------------------------------------
  if (data.startsWith('period:')) {
    if (user.role !== 'employee') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const period = data.slice('period:'.length);
    await employeeHandlers.handleActivityPeriod(ctx, period);
    return;
  }

  // -------------------------------------------------------------------------
  // deliverable:{skip|add_more|finish} prefix — employee only
  // (the old 'yes' choice is gone — files are requested directly after comment)
  // -------------------------------------------------------------------------
  if (data.startsWith('deliverable:')) {
    if (user.role !== 'employee') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const choice = data.slice('deliverable:'.length);

    if (choice === 'add_more' || choice === 'finish' || choice === 'skip') {
      await employeeHandlers.handleAddMoreOrFinish(ctx, choice === 'skip' ? 'finish' : choice);
    } else {
      logger.warn('router: unknown deliverable choice', choice);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // employee:{id} prefix — admin only
  // -------------------------------------------------------------------------
  if (data.startsWith('employee:')) {
    if (user.role !== 'admin') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const userId = data.slice('employee:'.length);
    await adminHandlers.handleEmployeeDetail(ctx, userId);
    return;
  }

  // -------------------------------------------------------------------------
  // task:{id} prefix — admin only
  // -------------------------------------------------------------------------
  if (data.startsWith('task:')) {
    if (user.role !== 'admin') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const taskId = data.slice('task:'.length);
    await adminHandlers.handleTaskDetail(ctx, taskId);
    return;
  }

  // -------------------------------------------------------------------------
  // filter:{value} prefix — admin only
  // -------------------------------------------------------------------------
  if (data.startsWith('filter:')) {
    if (user.role !== 'admin') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const filter = data.slice('filter:'.length);
    await adminHandlers.handleTasksFilter(ctx, filter);
    return;
  }

  // -------------------------------------------------------------------------
  // remove_admin:{userId} prefix — admin only
  // -------------------------------------------------------------------------
  if (data.startsWith('remove_admin:')) {
    if (user.role !== 'admin') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const targetUserId = data.slice('remove_admin:'.length);
    await adminHandlers.handleRemoveAdminConfirm(ctx, targetUserId);
    return;
  }

  // -------------------------------------------------------------------------
  // edit_employee:{userId} prefix — admin only
  // -------------------------------------------------------------------------
  if (data.startsWith('edit_employee:')) {
    if (user.role !== 'admin') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const targetUserId = data.slice('edit_employee:'.length);
    await adminHandlers.handleEditEmployeeName(ctx, targetUserId);
    return;
  }

  // -------------------------------------------------------------------------
  // edit_rate:{userId} prefix — admin only
  // -------------------------------------------------------------------------
  if (data.startsWith('edit_rate:')) {
    if (user.role !== 'admin') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const targetUserId = data.slice('edit_rate:'.length);
    await adminHandlers.handleEditEmployeeRate(ctx, targetUserId);
    return;
  }

  // -------------------------------------------------------------------------
  // remove_employee:{userId} prefix — admin only
  // -------------------------------------------------------------------------
  if (data.startsWith('remove_employee:')) {
    if (user.role !== 'admin') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const targetUserId = data.slice('remove_employee:'.length);
    await adminHandlers.handleRemoveEmployeeConfirm(ctx, targetUserId);
    return;
  }

  // -------------------------------------------------------------------------
  // invite_project:{projectId} — admin only (project selected for invite)
  // -------------------------------------------------------------------------
  if (data.startsWith('invite_project:')) {
    if (user.role !== 'admin') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const projectId = data.slice('invite_project:'.length);
    await adminHandlers.handleInviteProjectSelected(ctx, projectId);
    return;
  }

  // -------------------------------------------------------------------------
  // invite_role:{projectId}:{role} — admin only (role selected for invite)
  // -------------------------------------------------------------------------
  if (data.startsWith('invite_role:')) {
    if (user.role !== 'admin') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const parts = data.slice('invite_role:'.length).split(':');
    if (parts.length >= 2) {
      const projectId = parts[0];
      const role = parts[1] as 'admin' | 'employee';
      await adminHandlers.handleGenerateInviteLink(ctx, projectId, role);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // page:{prefix}:{n} prefix — admin only
  // -------------------------------------------------------------------------
  if (data.startsWith('page:')) {
    if (user.role !== 'admin') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    // Format: page:{prefix}:{n}
    // The prefix itself may contain colons (e.g. filter_project:{uuid})
    // so we split on the first two colons only.
    const withoutPagePrefix = data.slice('page:'.length);
    const lastColonIndex = withoutPagePrefix.lastIndexOf(':');
    if (lastColonIndex === -1) {
      logger.warn('router: malformed page callback_data', data);
      return;
    }
    const prefix = withoutPagePrefix.slice(0, lastColonIndex);
    const pageStr = withoutPagePrefix.slice(lastColonIndex + 1);
    const page = parseInt(pageStr, 10);
    if (isNaN(page)) {
      logger.warn('router: invalid page number in callback_data', data);
      return;
    }
    await adminHandlers.handlePagination(ctx, prefix, page);
    return;
  }

  // -------------------------------------------------------------------------
  // reuse_task:{taskId} prefix — employee only
  // -------------------------------------------------------------------------
  if (data.startsWith('reuse_task:')) {
    if (user.role !== 'employee') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const taskId = data.slice('reuse_task:'.length);
    await employeeHandlers.handleReuseTask(ctx, taskId);
    return;
  }

  // -------------------------------------------------------------------------
  // recent_page:{n} prefix — employee only
  // -------------------------------------------------------------------------
  if (data.startsWith('recent_page:')) {
    if (user.role !== 'employee') {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_PERMISSION);
      return;
    }
    const page = parseInt(data.slice('recent_page:'.length), 10);
    if (!isNaN(page)) await employeeHandlers.handleRecentTasks(ctx, page);
    return;
  }

  logger.warn('router: unrecognised callback_data', data);
}
