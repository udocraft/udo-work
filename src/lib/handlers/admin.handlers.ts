/**
 * Admin handlers for the Telegram Time Tracker bot.
 * Requirements: 2.1–2.4, 9.1–9.4, 10.1–10.5
 */

import * as telegramClient from '@/lib/telegram/client';
import { projectService } from '@/lib/services/project.service';
import { taskService } from '@/lib/services/task.service';
import { userService } from '@/lib/services/user.service';
import { membershipService } from '@/lib/services/membership.service';
import { sessionService } from '@/lib/services/session.service';
import { storageService } from '@/lib/services/storage.service';
import { MESSAGES } from '@/lib/messages';
import { logger } from '@/lib/utils/logger';
import { formatTimeSpent, formatDateTime, getStartOfWeek } from '@/lib/utils/time';
import {
  buildProjectKeyboard,
  buildEmployeeListKeyboard,
  buildTaskListKeyboard,
  buildPaginationKeyboard,
  buildFilterKeyboard,
  buildAdminListKeyboard,
  buildEmployeeRemoveKeyboard,
  buildInviteRoleKeyboard,
  buildToggleProjectKeyboard,
  ADMIN_MAIN_MENU,
  MANAGE_USERS_KEYBOARD,
} from '@/lib/telegram/keyboards';
import { DuplicateProjectError } from '@/types/index';
import { classifyError } from '@/lib/utils/errors';
import type { HandlerContext, TimeSpent, TelegramMessage } from '@/types/index';

const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sends a user-friendly error message based on the actual error type.
 * Never shows raw stack traces or internal error codes.
 */
async function sendSmartError(chatId: number, err: unknown, context?: string): Promise<void> {
  logger.error(`Admin handler error${context ? ` [${context}]` : ''}`, err);
  const msg = classifyError(err);
  await telegramClient.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: ADMIN_MAIN_MENU,
  });
}

// Keep old name as alias so existing call sites work unchanged
async function sendDbError(chatId: number, err: unknown): Promise<void> {
  return sendSmartError(chatId, err);
}

function esc(text: string): string {
  return text.replace(/[_*`[\]]/g, (c) => '\\' + c);
}

/** Format earnings with one decimal place for consistency (avoids rounding paradox). */
function fmtEarnings(minutes: number, rate: number): string {
  const raw = (minutes / 60) * rate;
  const rounded = Math.round(raw * 10) / 10;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
}

function statusEmoji(status: string): string {
  return status === 'in_progress' ? '▶️' : status === 'paused' ? '⏸' : '✅';
}

function statusLabel(status: string): string {
  return status === 'in_progress' ? 'В роботі' : status === 'paused' ? 'На паузі' : 'Завершено';
}

/** Edit message if messageId present, otherwise send new. */
async function reply(
  chatId: number,
  messageId: number | undefined,
  text: string,
  options: Parameters<typeof telegramClient.sendMessage>[2] = {},
): Promise<void> {
  if (messageId) {
    await telegramClient.editMessageText(chatId, messageId, text, options).catch(async () => {
      // If edit fails (e.g. message too old), fall back to new message
      await telegramClient.sendMessage(chatId, text, options);
    });
  } else {
    await telegramClient.sendMessage(chatId, text, options);
  }
}

// ---------------------------------------------------------------------------
// 2. Project management
// ---------------------------------------------------------------------------

export async function handleCreateProject(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    await sessionService.setState(user.id, 'awaiting_project_name');
    await reply(chatId, messageId, '📁 Введіть назву нового проєкту:\n\n_Або натисніть /cancel для скасування_', {
      parse_mode: 'Markdown',
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleProjectNameInput(ctx: HandlerContext, text: string): Promise<void> {
  const { user, chatId } = ctx;
  try {
    const project = await projectService.createProject(text.trim());
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId, MESSAGES.PROJECT_CREATED(esc(project.name)), {
      parse_mode: 'Markdown',
      reply_markup: ADMIN_MAIN_MENU,
    });
  } catch (err) {
    if (err instanceof DuplicateProjectError) {
      await telegramClient.sendMessage(chatId, MESSAGES.DUPLICATE_PROJECT);
    } else {
      await sessionService.resetSession(user.id);
      await sendDbError(chatId, err);
    }
  }
}

export async function handleDeactivateProject(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const projects = await projectService.getAllProjects();
    if (projects.length === 0) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    const lines = ['🗂️ *Управління проєктами*\n\nОберіть проєкт для зміни статусу:\n'];
    for (const p of projects) {
      const icon = p.is_active ? '🟢' : '🔴';
      lines.push(`${icon} ${esc(p.name)}`);
    }
    await reply(chatId, messageId, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: buildToggleProjectKeyboard(projects, 'action:back_to_main'),
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleDeactivateProjectConfirm(ctx: HandlerContext, projectId: string): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const project = await projectService.findById(projectId);
    if (!project) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    if (project.is_active) {
      await projectService.deactivateProject(projectId);
      await sessionService.resetSession(user.id);
      await reply(chatId, messageId, MESSAGES.PROJECT_DEACTIVATED(esc(project.name)), {
        parse_mode: 'Markdown',
        reply_markup: ADMIN_MAIN_MENU,
      });
    } else {
      await projectService.activateProject(projectId);
      await sessionService.resetSession(user.id);
      await reply(chatId, messageId, MESSAGES.PROJECT_ACTIVATED(esc(project.name)), {
        parse_mode: 'Markdown',
        reply_markup: ADMIN_MAIN_MENU,
      });
    }
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// 9. Employees
// ---------------------------------------------------------------------------

export async function handleEmployees(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const employees = await userService.getAllEmployeesWithWeeklyTime();
    if (employees.length === 0) {
      await reply(chatId, messageId,
        '👥 *Команда*\n\n📭 Жодного співробітника ще не додано.\n\nДодайте першого через *Управління користувачами*.',
        { parse_mode: 'Markdown', reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    const lines = [`👥 *Команда — ${employees.length} осіб*\n_Статистика за поточний тиждень:_\n`];
    for (const emp of employees) {
      const name = userService.getDisplayName(emp);
      const t: TimeSpent = { hours: Math.floor(emp.weeklyMinutes / 60), minutes: emp.weeklyMinutes % 60, totalMinutes: emp.weeklyMinutes };
      const timeStr = emp.weeklyMinutes === 0 ? '—' : formatTimeSpent(t);
      const usernameStr = emp.username ? ` @${emp.username}` : '';
      let salaryStr = '';
      if (emp.hourly_rate && emp.weeklyMinutes > 0) {
        const earned = fmtEarnings(emp.weeklyMinutes, emp.hourly_rate);
        salaryStr = ` · 💰 ~${earned} грн`;
      } else if (emp.hourly_rate) {
        salaryStr = ` · 💵 ${emp.hourly_rate} грн/год`;
      }
      lines.push(`👤 *${esc(name)}*${usernameStr ? ` _(${usernameStr})_` : ''}\n   ⏱️ ${timeStr}${salaryStr}`);
    }
    lines.push('\n_Натисніть на ім\'я для деталей_');
    await reply(chatId, messageId, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: buildEmployeeListKeyboard(employees, 'action:back_to_main'),
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleEmployeeDetail(ctx: HandlerContext, userId: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const [activities, employees] = await Promise.all([
      taskService.getTasksForUser(userId, getStartOfWeek(), new Date()),
      userService.getAllEmployeesWithWeeklyTime(),
    ]);
    const employee = employees.find((e) => e.id === userId);
    const name = employee ? userService.getDisplayName(employee) : userId;
    const back = { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:employees' }]] };

    if (activities.length === 0) {
      await reply(chatId, messageId,
        `👤 *${esc(name)}*\n\n📭 За поточний тиждень задач не знайдено.`,
        { parse_mode: 'Markdown', reply_markup: back });
      return;
    }

    const totalMin = activities.reduce((s, a) => s + a.timeSpent.totalMinutes, 0);
    const totalTime = { hours: Math.floor(totalMin / 60), minutes: totalMin % 60, totalMinutes: totalMin };

    const lines: string[] = [];

    // Header
    const usernameStr = employee?.username ? ` · @${esc(employee.username)}` : '';
    lines.push(`👤 *${esc(name)}*${usernameStr}`);
    if (employee?.hourly_rate) {
      lines.push(`💵 Ставка: *${employee.hourly_rate} грн/год*`);
    }
    lines.push('');
    lines.push(`📅 *Задачі за тиждень (${activities.length}):*\n`);

    for (const a of activities) {
      const timeStr = formatTimeSpent(a.timeSpent);
      let salaryStr = '';
      if (employee?.hourly_rate && a.timeSpent.totalMinutes > 0) {
        const earned = fmtEarnings(a.timeSpent.totalMinutes, employee.hourly_rate);
        salaryStr = ` · 💰 ~${earned} грн`;
      }
      lines.push(`${statusEmoji(a.status)} *${esc(a.taskName)}*`);
      lines.push(`   📁 ${esc(a.projectName)} · ${statusLabel(a.status)}`);
      lines.push(`   ⏱️ ${timeStr}${salaryStr}\n`);
    }

    // Summary
    lines.push(`─────────────────`);
    lines.push(`⏱️ *Загалом:* ${formatTimeSpent(totalTime)}`);
    if (employee?.hourly_rate && totalMin > 0) {
      const earnings = fmtEarnings(totalMin, employee.hourly_rate);
      lines.push(`💰 *Заробіток:* ~${earnings} грн _(${employee.hourly_rate} грн/год)_`);
    }

    await reply(chatId, messageId, lines.join('\n'), { parse_mode: 'Markdown', reply_markup: back });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// 10. Tasks & Logs
// ---------------------------------------------------------------------------

export async function handleTasksLogs(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  await reply(chatId, messageId, '📋 Оберіть фільтр для перегляду задач:', { reply_markup: buildFilterKeyboard() });
}

export async function handleTasksFilter(ctx: HandlerContext, filter: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    if (filter === 'all') {
      const { tasks, total } = await taskService.getTasksWithFilters({}, 0);
      if (tasks.length === 0) {
        await reply(chatId, messageId, '📭 Задач не знайдено.', { reply_markup: buildFilterKeyboard() });
        return;
      }
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const pagination = buildPaginationKeyboard(0, totalPages, 'tasks');
      await reply(chatId, messageId, `📋 *Всі задачі* (${total}):`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            ...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard,
            ...pagination.inline_keyboard,
          ],
        },
      });
    } else if (filter === 'by_project') {
      const projects = await projectService.getActiveProjects();
      if (projects.length === 0) {
        await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: buildFilterKeyboard() });
        return;
      }
      await reply(chatId, messageId, '📁 Оберіть проєкт:', {
        reply_markup: buildProjectKeyboard(projects, 'action:tasks_logs'),
      });
    } else if (filter === 'by_employee') {
      const employees = await userService.getAllEmployeesWithWeeklyTime();
      if (employees.length === 0) {
        await reply(chatId, messageId, '👥 Співробітників не знайдено.', { reply_markup: buildFilterKeyboard() });
        return;
      }
      await reply(chatId, messageId, '👤 Оберіть співробітника:', {
        reply_markup: buildEmployeeListKeyboard(employees, 'action:tasks_logs'),
      });
    }
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleTaskDetail(ctx: HandlerContext, taskId: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const [timeLogs, attachments] = await Promise.all([
      taskService.getTimeLogs(taskId),
      storageService.getAttachments(taskId),
    ]);

    // Compute total time
    const totalTime = taskService.calculateTotalTime(timeLogs);
    const totalStr = totalTime.totalMinutes > 0 ? formatTimeSpent(totalTime) : '—';

    const lines = ['📋 *Деталі задачі*\n'];
    lines.push(`⏱️ *Загальний час:* ${totalStr}`);

    if (timeLogs.length === 0) {
      lines.push('\n📅 *Логи часу:* відсутні');
    } else {
      lines.push(`\n📅 *Логи часу (${timeLogs.length} інтервалів):*`);
      for (let i = 0; i < timeLogs.length; i++) {
        const log = timeLogs[i];
        const endStr = log.paused_at ?? log.ended_at;
        let durStr = '';
        if (endStr) {
          const diffMin = Math.floor((new Date(endStr).getTime() - new Date(log.started_at).getTime()) / 60000);
          if (diffMin > 0) {
            const h = Math.floor(diffMin / 60), m = diffMin % 60;
            durStr = ` _(${h > 0 ? `${h}г ` : ''}${m}хв)_`;
          }
        }
        lines.push(`\n*${i + 1}.* 🟢 ${formatDateTime(log.started_at)}${durStr}`);
        if (log.paused_at) lines.push(`   ⏸️ ${formatDateTime(log.paused_at)}`);
        if (log.ended_at) lines.push(`   🔴 ${formatDateTime(log.ended_at)}`);
        if (!log.paused_at && !log.ended_at) lines.push(`   ▶️ _(активний зараз)_`);
      }
    }

    if (attachments.length > 0) {
      lines.push('\n📎 *Результати та коментарі:*');
      for (const a of attachments) {
        if (a.type === 'text') {
          lines.push(`  💬 ${esc(a.content)}`);
        } else {
          // Content is stored as "filename\nstoragePath"
          const newlineIdx = a.content.indexOf('\n');
          if (newlineIdx !== -1) {
            const fileName = a.content.slice(0, newlineIdx);
            const storagePath = a.content.slice(newlineIdx + 1);
            try {
              const fileUrl = await storageService.regenerateSignedUrl(storagePath);
              lines.push(`  📄 [${esc(fileName)}](${fileUrl})`);
            } catch (err) {
              logger.error('Failed to regenerate signed URL for attachment', err);
              lines.push(`  📄 ${esc(fileName)} _(недоступний)_`);
            }
          } else {
            // Legacy format: content is just the URL (may be expired)
            lines.push(`  📄 [Файл](${a.content})`);
          }
        }
      }
    }

    const back = { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:tasks_logs' }]] };
    await reply(chatId, messageId, lines.join('\n'), { parse_mode: 'Markdown', reply_markup: back });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handlePagination(ctx: HandlerContext, prefix: string, page: number): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    if (prefix === 'tasks') {
      const { tasks, total } = await taskService.getTasksWithFilters({}, page);
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const pagination = buildPaginationKeyboard(page, totalPages, 'tasks');
      await reply(chatId, messageId, `📋 *Всі задачі* (${total}), стор. ${page + 1}/${totalPages}:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard, ...pagination.inline_keyboard] },
      });
    } else if (prefix.startsWith('filter_project:')) {
      const projectId = prefix.slice('filter_project:'.length);
      const { tasks, total } = await taskService.getTasksWithFilters({ projectId }, page);
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const pagination = buildPaginationKeyboard(page, totalPages, prefix);
      await reply(chatId, messageId, `📁 *Задачі за проєктом* (${total}), стор. ${page + 1}/${totalPages}:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard, ...pagination.inline_keyboard] },
      });
    } else if (prefix.startsWith('filter_employee:')) {
      const userId = prefix.slice('filter_employee:'.length);
      const { tasks, total } = await taskService.getTasksWithFilters({ userId }, page);
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const pagination = buildPaginationKeyboard(page, totalPages, prefix);
      await reply(chatId, messageId, `👤 *Задачі за співробітником* (${total}), стор. ${page + 1}/${totalPages}:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard, ...pagination.inline_keyboard] },
      });
    }
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleProjectTasksFilter(ctx: HandlerContext, projectId: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const [project, { tasks, total }] = await Promise.all([
      projectService.findById(projectId),
      taskService.getTasksWithFilters({ projectId }, 0),
    ]);
    const name = project?.name ?? projectId;
    if (tasks.length === 0) {
      await reply(chatId, messageId, `📁 *${esc(name)}*\n\n📭 Задач не знайдено.`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:tasks_logs' }]] },
      });
      return;
    }
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const pagination = buildPaginationKeyboard(0, totalPages, `filter_project:${projectId}`);
    await reply(chatId, messageId, `📁 *${esc(name)}* — задачі (${total}):`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard, ...pagination.inline_keyboard] },
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleEmployeeTasksFilter(ctx: HandlerContext, userId: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const [{ tasks, total }, employees] = await Promise.all([
      taskService.getTasksWithFilters({ userId }, 0),
      userService.getAllEmployeesWithWeeklyTime(),
    ]);
    const employee = employees.find((e) => e.id === userId);
    const name = employee ? userService.getDisplayName(employee) : userId;
    if (tasks.length === 0) {
      await reply(chatId, messageId, `👤 *${esc(name)}*\n\n📭 Задач не знайдено.`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:tasks_logs' }]] },
      });
      return;
    }
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const pagination = buildPaginationKeyboard(0, totalPages, `filter_employee:${userId}`);
    await reply(chatId, messageId, `👤 *${esc(name)}* — задачі (${total}):`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard, ...pagination.inline_keyboard] },
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// Admin / user management
// ---------------------------------------------------------------------------

export async function handleManageAdmins(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  await reply(chatId, messageId, MESSAGES.MANAGE_USERS_PROMPT, { reply_markup: MANAGE_USERS_KEYBOARD });
}

export async function handleAddAdmin(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    await sessionService.setState(user.id, 'awaiting_new_admin_id');
    await reply(chatId, messageId, MESSAGES.ADD_ADMIN_PROMPT, { parse_mode: 'Markdown' });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleAddEmployee(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    await sessionService.setState(user.id, 'awaiting_new_employee_id');
    await reply(chatId, messageId, MESSAGES.ADD_EMPLOYEE_PROMPT, { parse_mode: 'Markdown' });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

async function resolveUserFromMessage(message: TelegramMessage): Promise<{ telegramId: number; firstName?: string; username?: string; privacyBlocked?: boolean } | null> {
  // 1. New Bot API: forward_origin with sender_user (privacy allowed)
  if (message.forward_origin?.type === 'user' && message.forward_origin.sender_user) {
    return {
      telegramId: message.forward_origin.sender_user.id,
      firstName: message.forward_origin.sender_user.first_name,
      username: message.forward_origin.sender_user.username,
    };
  }

  // 2. Old Bot API: forward_from (privacy allowed)
  if (message.forward_from) {
    return {
      telegramId: message.forward_from.id,
      firstName: message.forward_from.first_name,
      username: message.forward_from.username,
    };
  }

  // 3. Forward with privacy enabled — sender hid their identity
  if (
    message.forward_origin?.type === 'hidden_user' ||
    message.forward_sender_name ||
    (message.forward_origin && !message.forward_origin.sender_user)
  ) {
    const name = message.forward_origin?.sender_user_name ?? message.forward_sender_name ?? 'невідомий';
    return { telegramId: 0, firstName: name, privacyBlocked: true };
  }

  const text = (message.text ?? '').trim();

  // 4. @username text input
  if (text.startsWith('@')) {
    return { telegramId: 0, username: text.slice(1) };
  }

  // 5. Numeric ID text input
  const id = parseInt(text, 10);
  if (!isNaN(id) && id > 0) {
    return { telegramId: id };
  }

  return null;
}

export async function handleNewAdminIdInput(ctx: HandlerContext, message: TelegramMessage): Promise<void> {
  await handleAddUserInput(ctx, message, 'admin');
}

export async function handleNewEmployeeIdInput(ctx: HandlerContext, message: TelegramMessage): Promise<void> {
  await handleAddUserInput(ctx, message, 'employee');
}

async function handleAddUserInput(ctx: HandlerContext, message: TelegramMessage, role: 'admin' | 'employee'): Promise<void> {
  const { user, chatId } = ctx;
  const backKeyboard = { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:manage_admins' }]] };

  const resolved = await resolveUserFromMessage(message);

  if (!resolved) {
    await telegramClient.sendMessage(chatId,
      `⚠️ *Не вдалося розпізнати користувача*\n\n` +
      `Спробуйте один із варіантів:\n` +
      `• Перешліть будь-яке повідомлення від цієї людини\n` +
      `• Введіть їх @username\n` +
      `• Введіть числовий Telegram ID\n\n` +
      `_/cancel — скасувати_`,
      { parse_mode: 'Markdown', reply_markup: backKeyboard });
    return;
  }

  if (resolved.telegramId === 0) {
    if (resolved.privacyBlocked) {
      const name = resolved.firstName ?? 'цей користувач';
      await telegramClient.sendMessage(chatId,
        `🔒 *${esc(name)}* приховав свій профіль у налаштуваннях Telegram.\n\n` +
        `Попросіть їх:\n` +
        `1️⃣ Написати боту /start\n` +
        `2️⃣ Або вимкнути *Налаштування → Конфіденційність → Пересилання повідомлень → Ніхто*\n\n` +
        `Після цього перешліть їхнє повідомлення сюди.\n\n` +
        `_Або введіть їх числовий ID вручну._`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard });
      return;
    }

    // @username provided — try to find them in the DB
    if (resolved.username) {
      const existingByUsername = await userService.findByUsername(resolved.username);
      if (existingByUsername) {
        const roleLabel = existingByUsername.role === 'admin' ? '🔑 Адмін' : '👤 Співробітник';
        const name = userService.getDisplayName(existingByUsername);
        await telegramClient.sendMessage(chatId,
          `ℹ️ *Вже зареєстрований*\n\n` +
          `👤 ${esc(name)}\n` +
          `${roleLabel}\n` +
          `🆔 \`${existingByUsername.telegram_id}\``,
          { parse_mode: 'Markdown', reply_markup: backKeyboard });
        return;
      }
      // Username not in DB — create with null telegram_id as placeholder
      // When they /start the bot, their real ID will be matched by username
      const newUser = await userService.createUser(null, role, undefined, resolved.username);
      await sessionService.resetSession(user.id);
      await telegramClient.sendMessage(chatId,
        `✅ *@${esc(resolved.username)}* додано як ${role === 'admin' ? 'адміна' : 'співробітника'}.\n\n` +
        `⚠️ Telegram ID ще невідомий. Коли ця людина напише боту /start, вона автоматично отримає доступ.\n\n` +
        `_Або введіть їх числовий ID для негайного доступу._`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard });
      return;
    }

    return;
  }

  try {
    const existing = await userService.findByTelegramId(resolved.telegramId);
    if (existing) {
      const roleLabel = existing.role === 'admin' ? '🔑 Адмін' : '👤 Співробітник';
      const name = userService.getDisplayName(existing);
      await telegramClient.sendMessage(chatId,
        `ℹ️ *Вже зареєстрований*\n\n` +
        `👤 ${esc(name)}\n` +
        `${roleLabel}\n` +
        `🆔 \`${existing.telegram_id}\``,
        { parse_mode: 'Markdown', reply_markup: backKeyboard });
      return;
    }

    const newUser = await userService.createUser(resolved.telegramId, role, resolved.firstName, resolved.username);

    // If no name was obtained, ask admin to provide one
    if (!newUser.first_name && !newUser.username) {
      await sessionService.setState(user.id, 'awaiting_new_user_name', {
        pendingUserId: newUser.id,
        pendingRole: role,
      });
      await telegramClient.sendMessage(chatId,
        `✅ Користувача додано (ID: \`${resolved.telegramId}\`)\n\n` +
        `📝 *Введіть ім'я для цього користувача*\n` +
        `_(щоб він відображався зрозуміло в списках)_\n\n` +
        `_Або /skip щоб пропустити_`,
        { parse_mode: 'Markdown' });
      return;
    }

    await sessionService.resetSession(user.id);
    await showUserAddedConfirmation(chatId, newUser, role);
  } catch (err) {
    await sessionService.resetSession(user.id);
    await sendDbError(chatId, err);
  }
}

/** Called when admin types a name for a newly added nameless user. */
export async function handleNewUserNameInput(ctx: HandlerContext, text: string): Promise<void> {
  const { user, session, chatId } = ctx;
  const sessionCtx = session.context as { pendingUserId?: string; pendingRole?: string } | null;

  if (!sessionCtx?.pendingUserId) {
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId, MESSAGES.SESSION_RESET, { reply_markup: ADMIN_MAIN_MENU });
    return;
  }

  try {
    const name = text.trim();
    await userService.updateFirstName(sessionCtx.pendingUserId, name);
    await sessionService.resetSession(user.id);

    const role = (sessionCtx.pendingRole ?? 'employee') as 'admin' | 'employee';
    await telegramClient.sendMessage(chatId,
      `✅ *Користувача успішно додано*\n\n` +
      `👤 *${esc(name)}*\n` +
      `${role === 'admin' ? '🔑 Адмін' : '👷 Співробітник'}\n\n` +
      `Тепер вони можуть використовувати бот після команди /start`,
      { parse_mode: 'Markdown', reply_markup: ADMIN_MAIN_MENU });
  } catch (err) {
    await sessionService.resetSession(user.id);
    await sendDbError(chatId, err);
  }
}

async function showUserAddedConfirmation(chatId: number, newUser: import('@/types/index').User, role: 'admin' | 'employee'): Promise<void> {
  const name = userService.getDisplayName(newUser);
  const roleLabel = role === 'admin' ? '🔑 Адмін' : '👷 Співробітник';
  const usernameStr = newUser.username ? `\n@${newUser.username}` : '';
  await telegramClient.sendMessage(chatId,
    `✅ *Користувача успішно додано*\n\n` +
    `👤 *${esc(name)}*${usernameStr}\n` +
    `${roleLabel}\n` +
    `🆔 \`${newUser.telegram_id}\`\n\n` +
    `Тепер вони можуть використовувати бот після команди /start`,
    { parse_mode: 'Markdown', reply_markup: ADMIN_MAIN_MENU });
}

export async function handleRemoveAdmin(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const admins = await userService.getAllAdmins();
    const others = admins.filter((a) => a.id !== user.id);
    if (others.length === 0) {
      await reply(chatId, messageId, MESSAGES.NO_ADMINS_TO_REMOVE, { reply_markup: MANAGE_USERS_KEYBOARD });
      return;
    }
    await reply(chatId, messageId, '🗑 Оберіть адміна для видалення:', { reply_markup: buildAdminListKeyboard(others) });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleRemoveAdminConfirm(ctx: HandlerContext, targetUserId: string): Promise<void> {
  const { user, chatId, messageId } = ctx;
  if (targetUserId === user.id) {
    await reply(chatId, messageId, MESSAGES.CANNOT_REMOVE_SELF, { reply_markup: MANAGE_USERS_KEYBOARD });
    return;
  }
  try {
    const admins = await userService.getAllAdmins();
    const target = admins.find((a) => a.id === targetUserId);
    if (!target) {
      await reply(chatId, messageId, '⚠️ Адміна не знайдено.', { reply_markup: MANAGE_USERS_KEYBOARD });
      return;
    }
    await userService.deleteUser(targetUserId);
    const name = userService.getDisplayName(target);
    await reply(chatId, messageId,
      `✅ *${esc(name)}* видалено з системи.`,
      { parse_mode: 'Markdown', reply_markup: ADMIN_MAIN_MENU });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// Remove employee
// ---------------------------------------------------------------------------

export async function handleRemoveEmployee(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const employees = await userService.getAllEmployees();
    if (employees.length === 0) {
      await reply(chatId, messageId, '⚠️ Немає співробітників для видалення.', { reply_markup: MANAGE_USERS_KEYBOARD });
      return;
    }
    await reply(chatId, messageId, '🗑 Оберіть співробітника для видалення:', {
      reply_markup: buildEmployeeRemoveKeyboard(employees),
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleRemoveEmployeeConfirm(ctx: HandlerContext, targetUserId: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const employees = await userService.getAllEmployees();
    const target = employees.find((e) => e.id === targetUserId);
    if (!target) {
      await reply(chatId, messageId, '⚠️ Співробітника не знайдено.', { reply_markup: MANAGE_USERS_KEYBOARD });
      return;
    }
    await userService.deleteUser(targetUserId);
    const name = userService.getDisplayName(target);
    await reply(chatId, messageId,
      `✅ *${esc(name)}* видалено з системи.`,
      { parse_mode: 'Markdown', reply_markup: ADMIN_MAIN_MENU });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// Edit employee name
// ---------------------------------------------------------------------------

export async function handleEditEmployeeName(ctx: HandlerContext, targetUserId: string): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const employees = await userService.getAllEmployees();
    const target = employees.find((e) => e.id === targetUserId);
    if (!target) {
      await reply(chatId, messageId, '⚠️ Співробітника не знайдено.', { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    await sessionService.setState(user.id, 'awaiting_edit_employee_name', { pendingUserId: targetUserId });
    const currentName = userService.getDisplayName(target);
    await telegramClient.sendMessage(chatId,
      `✏️ *Редагування імені*\n\nПоточне ім'я: *${esc(currentName)}*\n\nВведіть нове ім'я:\n_/cancel — скасувати_`,
      { parse_mode: 'Markdown' });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleEditEmployeeNameInput(ctx: HandlerContext, text: string): Promise<void> {
  const { user, session, chatId } = ctx;
  const sessionCtx = session.context as { pendingUserId?: string } | null;

  if (!sessionCtx?.pendingUserId) {
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId, MESSAGES.SESSION_RESET, { reply_markup: ADMIN_MAIN_MENU });
    return;
  }

  try {
    const name = text.trim();
    if (!name) {
      await telegramClient.sendMessage(chatId, '⚠️ Ім\'я не може бути порожнім.');
      return;
    }
    await userService.updateFirstName(sessionCtx.pendingUserId, name);
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId,
      `✅ Ім'я змінено на *${esc(name)}*`,
      { parse_mode: 'Markdown', reply_markup: ADMIN_MAIN_MENU });
  } catch (err) {
    await sessionService.resetSession(user.id);
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// Edit employee hourly rate
// ---------------------------------------------------------------------------

export async function handleEditEmployeeRate(ctx: HandlerContext, targetUserId: string): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const employees = await userService.getAllEmployees();
    const target = employees.find((e) => e.id === targetUserId);
    if (!target) {
      await reply(chatId, messageId, '⚠️ Співробітника не знайдено.', { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    await sessionService.setState(user.id, 'awaiting_edit_hourly_rate', { pendingUserId: targetUserId });
    const currentRate = target.hourly_rate ? `${target.hourly_rate} грн/год` : 'не встановлено';
    const name = userService.getDisplayName(target);
    await telegramClient.sendMessage(chatId,
      `💰 *Ставка: ${esc(name)}*\n\nПоточна ставка: *${currentRate}*\n\nВведіть нову ставку в грн/год (наприклад: 150):\n_/skip — прибрати ставку_\n_/cancel — скасувати_`,
      { parse_mode: 'Markdown' });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleEditEmployeeRateInput(ctx: HandlerContext, text: string): Promise<void> {
  const { user, session, chatId } = ctx;
  const sessionCtx = session.context as { pendingUserId?: string } | null;

  if (!sessionCtx?.pendingUserId) {
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId, MESSAGES.SESSION_RESET, { reply_markup: ADMIN_MAIN_MENU });
    return;
  }

  try {
    if (text === '/skip') {
      await userService.updateHourlyRate(sessionCtx.pendingUserId, null);
      await sessionService.resetSession(user.id);
      await telegramClient.sendMessage(chatId, '✅ Ставку прибрано.', { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    const rate = parseFloat(text.replace(',', '.'));
    if (isNaN(rate) || rate < 0) {
      await telegramClient.sendMessage(chatId, '⚠️ Введіть коректне число (наприклад: 150 або 87.5).');
      return;
    }
    await userService.updateHourlyRate(sessionCtx.pendingUserId, rate);
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId,
      `✅ Ставку встановлено: *${rate} грн/год*`,
      { parse_mode: 'Markdown', reply_markup: ADMIN_MAIN_MENU });
  } catch (err) {
    await sessionService.resetSession(user.id);
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

/** Shows project selection for generating an invite link. */
export async function handleInviteToProject(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const projects = await projectService.getActiveProjects();
    if (projects.length === 0) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    await reply(chatId, messageId, '🔗 Оберіть проєкт для генерації запрошення:', {
      reply_markup: buildProjectKeyboard(projects, 'action:back_to_main', 'invite_project'),
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/** Shows role selection after project is chosen for invite. */
export async function handleInviteProjectSelected(ctx: HandlerContext, projectId: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const project = await projectService.findById(projectId);
    if (!project) {
      await reply(chatId, messageId, '⚠️ Проєкт не знайдено.', { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    await reply(chatId, messageId, `🔗 *${esc(project.name)}*\n\nОберіть роль для запрошення:`, {
      parse_mode: 'Markdown',
      reply_markup: buildInviteRoleKeyboard(projectId),
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/** Generates and sends the invite link. */
export async function handleGenerateInviteLink(ctx: HandlerContext, projectId: string, role: 'admin' | 'employee'): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const project = await projectService.findById(projectId);
    if (!project) {
      await reply(chatId, messageId, '⚠️ Проєкт не знайдено.', { reply_markup: ADMIN_MAIN_MENU });
      return;
    }

    const link = await membershipService.createInviteLink(projectId, role, user.id);
    const roleLabel = role === 'admin' ? 'адміністратора' : 'співробітника';
    const roleEmoji = role === 'admin' ? '🔑' : '👷';

    // Plain text — no parse_mode to avoid URL escaping issues with ? and =
    await reply(chatId, messageId,
      `🔗 Запрошення до проєкту\n\n` +
      `📁 Проєкт: ${project.name}\n` +
      `${roleEmoji} Роль: ${roleLabel}\n` +
      `⏳ Дійсне: 7 днів · одноразове\n\n` +
      `Скопіюйте посилання нижче та надішліть його ${roleLabel === 'адміністратора' ? 'новому адміну' : 'співробітнику'}:\n\n` +
      `${link}\n\n` +
      `Людина відкриває посилання → Telegram запускає бота → автоматично додається до проєкту.\n` +
      `Посилання одноразове — після використання стає недійсним.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Нове запрошення', callback_data: `invite_role:${projectId}:${role}` }],
            [{ text: '◀️ Головне меню', callback_data: 'action:back_to_main' }],
          ],
        },
      },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}
