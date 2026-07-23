/**
 * Inline keyboard builders for the Telegram Time Tracker bot.
 * Exports static keyboards and dynamic builder functions.
 *
 * UX principles applied:
 * - Rich emoji usage for visual clarity
 * - Grouped actions in logical rows
 * - Back navigation always present
 * - Destructive actions clearly labeled
 *
 * Requirements: 3.1, 8.1, 9.1, 10.1, 10.5
 */

import type { Project, User, Task } from '@/types';
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup } from './types';

// ---------------------------------------------------------------------------
// Static keyboards
// ---------------------------------------------------------------------------

/** Main menu shown to employees — static fallback (no active task). */
export const EMPLOYEE_MAIN_MENU: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '🚀 Почати задачу', callback_data: 'action:start_task' }],
    [{ text: '🔁 Повторити задачу', callback_data: 'action:recent_tasks' }],
    [{ text: '📊 Моя активність', callback_data: 'action:my_activity' }],
  ],
};

/**
 * Builds a context-aware employee menu based on current task state.
 * Only shows actions that are valid for the current state.
 */
export function buildContextualEmployeeMenu(
  taskStatus: 'in_progress' | 'paused' | null,
  telegramId?: number | null,
): InlineKeyboardMarkup {
  const rows: { text: string; callback_data: string }[][] = [];

  if (!taskStatus) {
    // No active task — show start options
    rows.push([{ text: '🚀 Почати задачу', callback_data: 'action:start_task' }]);
    rows.push([{ text: '🔁 Повторити задачу', callback_data: 'action:recent_tasks' }]);
  } else if (taskStatus === 'in_progress') {
    // Task running — can pause or complete
    rows.push([
      { text: '⏸️ Пауза', callback_data: 'action:pause_task' },
      { text: '✅ Завершити', callback_data: 'action:complete_task' },
    ]);
  } else if (taskStatus === 'paused') {
    // Task paused — can resume or complete
    rows.push([
      { text: '▶️ Відновити', callback_data: 'action:resume_task' },
      { text: '✅ Завершити', callback_data: 'action:complete_task' },
    ]);
  }

  rows.push([{ text: '📊 Моя активність', callback_data: 'action:my_activity' }]);

  if (telegramId) {
    rows.push([{ text: '⏱️ Відкрити таймер', web_app: { url: `https://udo-work.vercel.app/app?tid=${telegramId}` } } as any]);
  }

  return { inline_keyboard: rows };
}

/**
 * Builds the employee main menu with a personalised app link.
 */
export function buildEmployeeMainMenu(telegramId: number | null): InlineKeyboardMarkup {
  return buildContextualEmployeeMenu(null, telegramId);
}

/** Main menu shown to admins (static fallback without dashboard link). */
export const ADMIN_MAIN_MENU: InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: '➕ Створити проєкт', callback_data: 'action:create_project' },
      { text: '🔗 Запросити', callback_data: 'action:invite_to_project' },
    ],
    [
      { text: '🟢 Активувати / 🔴 Деактивувати', callback_data: 'action:deactivate_project' },
    ],
    [{ text: '👥 Команда', callback_data: 'action:employees' }],
    [{ text: '📋 Задачі та логи', callback_data: 'action:tasks_logs' }],
    [{ text: '⚙️ Управління користувачами', callback_data: 'action:manage_admins' }],
  ],
};

/**
 * Builds the admin main menu with a personalised app link.
 * Opens the unified /app route which redirects admins to the dashboard.
 */
export function buildAdminMainMenu(telegramId: number | null): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...ADMIN_MAIN_MENU.inline_keyboard,
      ...(telegramId ? [[{ text: '📊 Відкрити дашборд', web_app: { url: `https://udo-work.vercel.app/app?tid=${telegramId}` } }]] : []),
    ],
  };
}

/** Admin management keyboard. */
export const MANAGE_USERS_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: '➕ Додати адміна', callback_data: 'action:add_admin' },
      { text: '➕ Додати співробітника', callback_data: 'action:add_employee' },
    ],
    [
      { text: '🗑️ Видалити адміна', callback_data: 'action:remove_admin' },
      { text: '🗑️ Видалити співробітника', callback_data: 'action:remove_employee' },
    ],
    [{ text: '◀️ Назад', callback_data: 'action:back_to_main' }],
  ],
};

/** Period selector for activity report. */
export const ACTIVITY_PERIOD_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: '📅 Сьогодні', callback_data: 'period:today' },
      { text: '📆 Цей тиждень', callback_data: 'period:week' },
    ],
    [{ text: '◀️ Назад', callback_data: 'action:back_to_main' }],
  ],
};

/** Asks whether to attach a deliverable before completing a task. */
export const DELIVERABLE_CHOICE_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '📎 Прикріпити результат', callback_data: 'deliverable:yes' }],
    [{ text: '⏭️ Пропустити', callback_data: 'deliverable:skip' }],
  ],
};

/** Shown after each deliverable is saved. */
export const ADD_MORE_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '➕ Додати ще', callback_data: 'deliverable:add_more' }],
    [{ text: '✅ Завершити', callback_data: 'deliverable:finish' }],
  ],
};

// ---------------------------------------------------------------------------
// Dynamic keyboard builders
// ---------------------------------------------------------------------------

/**
 * Builds a keyboard listing all projects with toggle status buttons.
 */
export function buildToggleProjectKeyboard(
  projects: Project[],
  backAction = 'action:back_to_main',
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...projects.map((p) => {
        const icon = p.is_active ? '🟢' : '🔴';
        const action = p.is_active ? 'Деактивувати' : 'Активувати';
        return [
          { text: `${icon} ${p.name} — ${action}`, callback_data: `project:${p.id}` },
        ];
      }),
      [{ text: '◀️ Назад', callback_data: backAction }],
    ],
  };
}

/**
 * Builds a keyboard listing active projects for task-start selection.
 * Requirements: 3.1
 */
export function buildProjectKeyboard(
  projects: Project[],
  backAction = 'action:back_to_main',
  callbackPrefix = 'project',
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...projects.map((p) => [
        { text: `📁 ${p.name}`, callback_data: `${callbackPrefix}:${p.id}` },
      ]),
      [{ text: '◀️ Назад', callback_data: backAction }],
    ],
  };
}

/**
 * Builds a keyboard listing employees with action buttons.
 * Requirements: 9.1
 */
export function buildEmployeeListKeyboard(
  employees: User[],
  backAction = 'action:employees',
  callbackPrefix = 'employee',
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...employees.map((e) => {
        const name = e.first_name ?? (e.username ? `@${e.username}` : `ID ${e.telegram_id}`);
        const rateLabel = e.hourly_rate ? ` · 💰${e.hourly_rate}₴` : '';
        return [
          { text: `👤 ${name}${rateLabel}`, callback_data: `${callbackPrefix}:${e.id}` },
          { text: '✏️', callback_data: `edit_employee:${e.id}` },
          { text: '💵', callback_data: `edit_rate:${e.id}` },
        ];
      }),
      [{ text: '◀️ Назад', callback_data: backAction }],
    ],
  };
}

/**
 * Builds a keyboard listing tasks.
 * Requirements: 10.1
 */
export function buildTaskListKeyboard(
  tasks: Task[],
  backAction = 'action:tasks_logs',
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...tasks.map((t) => [
        { text: `📌 ${t.name}`, callback_data: `task:${t.id}` },
      ]),
      [{ text: '◀️ Назад', callback_data: backAction }],
    ],
  };
}

/**
 * Builds a pagination keyboard.
 * Requirements: 10.5
 */
export function buildPaginationKeyboard(
  page: number,
  totalPages: number,
  prefix: string,
): InlineKeyboardMarkup {
  const buttons: { text: string; callback_data: string }[] = [];

  if (page > 0) {
    buttons.push({ text: `⬅️ Стор. ${page}`, callback_data: `page:${prefix}:${page - 1}` });
  }
  if (page < totalPages - 1) {
    buttons.push({ text: `Стор. ${page + 2} ➡️`, callback_data: `page:${prefix}:${page + 1}` });
  }

  return { inline_keyboard: buttons.length > 0 ? [buttons] : [] };
}

/**
 * Builds the filter keyboard for "Задачі та логи".
 * Requirements: 10.1
 */
export function buildFilterKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '📋 Всі задачі', callback_data: 'filter:all' }],
      [{ text: '📁 За проєктом', callback_data: 'filter:by_project' }],
      [{ text: '👤 За співробітником', callback_data: 'filter:by_employee' }],
      [{ text: '◀️ Назад', callback_data: 'action:back_to_main' }],
    ],
  };
}

/**
 * Builds a keyboard listing admins for removal.
 */
export function buildAdminListKeyboard(admins: User[]): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...admins.map((a) => {
        const label = a.first_name ?? (a.username ? `@${a.username}` : String(a.telegram_id));
        return [{ text: `🗑️ ${label}`, callback_data: `remove_admin:${a.id}` }];
      }),
      [{ text: '◀️ Назад', callback_data: 'action:manage_admins' }],
    ],
  };
}

/**
 * Builds a keyboard listing employees for removal.
 */
export function buildEmployeeRemoveKeyboard(employees: User[]): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...employees.map((e) => {
        const label = e.first_name ?? (e.username ? `@${e.username}` : String(e.telegram_id));
        return [{ text: `🗑️ ${label}`, callback_data: `remove_employee:${e.id}` }];
      }),
      [{ text: '◀️ Назад', callback_data: 'action:manage_admins' }],
    ],
  };
}

/**
 * Builds a keyboard for selecting invite role.
 */
export function buildInviteRoleKeyboard(projectId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '👷 Співробітник', callback_data: `invite_role:${projectId}:employee` },
        { text: '🔑 Адмін', callback_data: `invite_role:${projectId}:admin` },
      ],
      [{ text: '◀️ Назад', callback_data: 'action:invite_to_project' }],
    ],
  };
}

/**
 * Builds a keyboard listing recent tasks for reuse.
 */
export function buildRecentTasksKeyboard(
  tasks: Task[],
  page: number,
  totalPages: number,
): InlineKeyboardMarkup {
  const rows = tasks.map((t) => [{ text: `🔁 ${t.name}`, callback_data: `reuse_task:${t.id}` }]);
  const nav: { text: string; callback_data: string }[] = [];
  if (page > 0) nav.push({ text: `⬅️ Стор. ${page}`, callback_data: `recent_page:${page - 1}` });
  if (page < totalPages - 1) nav.push({ text: `Стор. ${page + 2} ➡️`, callback_data: `recent_page:${page + 1}` });
  if (nav.length > 0) rows.push(nav);
  rows.push([{ text: '◀️ Назад', callback_data: 'action:back_to_main' }]);
  return { inline_keyboard: rows };
}

// ---------------------------------------------------------------------------
// Reply keyboards (persistent keyboard shown below the text input)
// ---------------------------------------------------------------------------

/**
 * Persistent reply keyboard for employees.
 */
export const EMPLOYEE_REPLY_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: '🚀 Почати задачу' }, { text: '✅ Завершити задачу' }],
    [{ text: '⏸️ Пауза' }, { text: '▶️ Відновити' }],
    [{ text: '📊 Моя активність' }],
  ],
  resize_keyboard: true,
};

/**
 * Persistent reply keyboard for admins.
 */
export const ADMIN_REPLY_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: '➕ Створити проєкт' }, { text: '🔴 Деактивувати проєкт' }],
    [{ text: '👥 Команда' }, { text: '📋 Задачі та логи' }],
    [{ text: '⚙️ Управління користувачами' }, { text: '🔗 Запросити до проєкту' }],
  ],
  resize_keyboard: true,
};
