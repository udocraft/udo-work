'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, FolderOpen, FolderX, Zap, CheckCircle2, Clock, Play, Pause,
  Check, Trash2, Pencil, Plus, Search, RefreshCw,
  Lock, ToggleLeft, ToggleRight, User, List,
  History, Timer, ClipboardCheck, X, AlertTriangle,
  WifiOff, BarChart3, KeyRound, TrendingUp, Activity,
  ShieldCheck, ChevronRight, Briefcase, DollarSign, ArrowLeft,
  Wallet, CalendarDays,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthUser {
  id: string;
  telegram_id: number;
  role: string;
  first_name: string | null;
  username: string | null;
}

interface DashUser {
  id: string;
  telegram_id: number;
  role: 'admin' | 'employee';
  first_name: string | null;
  username: string | null;
  hourly_rate: number | null;
  created_at: string;
}

interface DashProject {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

interface Summary {
  totalEmployees: number;
  totalAdmins: number;
  activeProjects: number;
  inProgressTasks: number;
  completedThisWeek: number;
}

interface EmpStat {
  id: string;
  name: string;
  username: string | null;
  weeklyMinutes: number;
  activeTasks: number;
  hourlyRate: number | null;
}

interface ProjStat {
  id: string;
  name: string;
  taskCount: number;
  activeCount: number;
  totalMinutes: number;
}

interface TaskStat {
  id: string;
  name: string;
  status: 'in_progress' | 'paused' | 'completed';
  projectName: string;
  projectId: string;
  userName: string;
  userId: string;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  totalMinutes: number;
  activeMinutes: number;
  logCount: number;
  attachments: { id: string; type: 'file' | 'text'; content: string; created_at: string }[];
}

interface StatsData {
  summary: Summary;
  employees: EmpStat[];
  projects: ProjStat[];
  recentTasks: TaskStat[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SECRET = 'workbotsecret2026';
const HEADERS = { 'Content-Type': 'application/json', 'x-dashboard-secret': SECRET };

type Tab = 'overview' | 'team' | 'projects' | 'tasks' | 'admins';

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function fetchWithRetry(
  input: RequestInfo,
  init?: RequestInit,
  retries = 2,
  delayMs = 1000,
): Promise<Response> {
  let lastError: Error = new Error('Unknown error');
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      return res;
    } catch (err: any) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(minutes: number): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}хв`;
  if (m === 0) return `${h}г`;
  return `${h}г ${m}хв`;
}

/**
 * Format a salary amount consistently.
 * Uses one decimal place so per-task and total values always add up visually.
 * e.g. 3.5 → "3.5", 8.17 → "8.2", 100.0 → "100"
 */
function fmtMoney(amount: number): string {
  // Show one decimal only when there's a fractional part
  const rounded = Math.round(amount * 10) / 10;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
}

/** Calculate raw earnings (not rounded) from minutes and hourly rate. */
function calcEarnings(minutes: number, hourlyRate: number): number {
  return (minutes / 60) * hourlyRate;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(d: Date): string {
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function displayName(u: DashUser | EmpStat): string {
  if ('first_name' in u) {
    return u.first_name ?? (u.username ? `@${u.username}` : `ID ${u.telegram_id}`);
  }
  return u.name;
}

// ─── Icon component (Lucide) ─────────────────────────────────────────────────

// Centralised icon map — add entries here as needed
const ICONS = {
  users: Users,
  folder: FolderOpen,
  'folder-closed': FolderX,
  zap: Zap,
  'check-circle': CheckCircle2,
  clock: Clock,
  play: Play,
  pause: Pause,
  check: Check,
  trash: Trash2,
  edit: Pencil,
  money: DollarSign,
  plus: Plus,
  search: Search,
  refresh: RefreshCw,
  lock: Lock,
  'toggle-on': ToggleRight,
  'toggle-off': ToggleLeft,
  person: User,
  list: List,
  history: History,
  timer: Timer,
  task: ClipboardCheck,
  x: X,
  alert: AlertTriangle,
  'wifi-off': WifiOff,
  chart: BarChart3,
  key: KeyRound,
  trending: TrendingUp,
  activity: Activity,
  shield: ShieldCheck,
  chevron: ChevronRight,
  briefcase: Briefcase,
  wallet: Wallet,
  calendar: CalendarDays,
  back: ArrowLeft,
} as const;

type IconName = keyof typeof ICONS;

function Ic({
  name,
  size = 18,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Component = ICONS[name];
  return <Component size={size} className={`flex-shrink-0 ${className}`} aria-hidden="true" />;
}

// ─── Skeleton Loaders ─────────────────────────────────────────────────────────

function SkeletonLine({ width = 'w-full', height = 'h-4' }: { width?: string; height?: string }) {
  return (
    <div className={`${width} ${height} bg-gray-200 rounded animate-pulse`} />
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl px-4 py-3 shadow-sm space-y-2">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <SkeletonLine width="w-2/3" height="h-4" />
          <SkeletonLine width="w-1/3" height="h-3" />
        </div>
        <SkeletonLine width="w-12" height="h-4" />
      </div>
    </div>
  );
}

function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

function SkeletonStatCards() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-2xl p-4 bg-gray-100 animate-pulse space-y-2">
          <div className="w-8 h-8 rounded-lg bg-gray-200" />
          <div className="h-7 w-12 bg-gray-200 rounded" />
          <div className="h-3 w-20 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  );
}

// ─── Error State ──────────────────────────────────────────────────────────────

interface ErrorStateProps {
  endpoint: string;
  message: string;
  isNetwork?: boolean;
  onRetry: () => void;
  errorTime?: Date;
}

function ErrorState({ endpoint, message, isNetwork = false, onRetry, errorTime }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${isNetwork ? 'bg-orange-100 text-orange-500' : 'bg-red-100 text-red-500'}`}>
        <Ic name={isNetwork ? 'wifi-off' : 'alert'} size={28} />
      </div>
      <h3 className="text-base font-semibold text-gray-800 mb-1">
        {isNetwork ? 'Немає з\'єднання' : 'Помилка сервера'}
      </h3>
      <p className="text-sm text-gray-500 mb-1">{message}</p>
      <p className="text-xs text-gray-400 mb-5">
        <span className="font-mono">{endpoint}</span>
        {errorTime && <> · {fmtDateTime(errorTime)}</>}
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 bg-blue-600 active:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
      >
        <Ic name="refresh" size={15} />
        Спробувати ще раз
      </button>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4 text-gray-400">
        <Ic name={icon} size={28} />
      </div>
      <p className="text-sm font-semibold text-gray-700 mb-1">{title}</p>
      {hint && <p className="text-xs text-gray-400 max-w-xs leading-relaxed">{hint}</p>}
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TaskStat['status'] }) {
  if (status === 'in_progress') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
        В роботі
      </span>
    );
  }
  if (status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
        Пауза
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
      Завершено
    </span>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 id="modal-title" className="text-lg font-semibold text-gray-800">{title}</h3>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition-colors"
            aria-label="Закрити"
          >
            <Ic name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── User Modal ───────────────────────────────────────────────────────────────

interface UserModalProps {
  defaultRole?: 'admin' | 'employee';
  editUser?: DashUser | null;
  onClose: () => void;
  onSave: (data: { telegramId?: number; firstName: string; username: string; role: 'admin' | 'employee' }) => Promise<void>;
}

function UserModal({ defaultRole = 'employee', editUser, onClose, onSave }: UserModalProps) {
  const [telegramId, setTelegramId] = useState('');
  const [firstName, setFirstName] = useState(editUser?.first_name ?? '');
  const [username, setUsername] = useState(editUser?.username ?? '');
  const [role, setRole] = useState<'admin' | 'employee'>(editUser?.role ?? defaultRole);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const isEdit = !!editUser;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!isEdit && !telegramId) { setErr('Введіть Telegram ID'); return; }
    setSaving(true);
    try {
      await onSave({ telegramId: isEdit ? undefined : Number(telegramId), firstName, username, role });
      onClose();
    } catch (e: any) {
      setErr(e.message ?? 'Помилка збереження');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Редагувати користувача' : 'Додати користувача'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {!isEdit && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telegram ID *</label>
            <input
              type="number"
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="123456789"
              autoFocus
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ім'я</label>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Іван"
            autoFocus={isEdit}
          />
        </div>
        {!isEdit && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="ivan_ua"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Роль</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'employee')}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                <option value="employee">Співробітник</option>
                <option value="admin">Адмін</option>
              </select>
            </div>
          </>
        )}
        {err && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl px-3 py-2.5">
            <Ic name="alert" size={15} className="flex-shrink-0 text-red-500" />
            <p className="text-sm">{err}</p>
          </div>
        )}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-blue-600 active:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
        >
          {saving ? 'Збереження...' : 'Зберегти'}
        </button>
      </form>
    </Modal>
  );
}

// ─── Project Modal ────────────────────────────────────────────────────────────

function ProjectModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr('Введіть назву проєкту'); return; }
    setSaving(true);
    try {
      await onSave(name.trim());
      onClose();
    } catch (e: any) {
      setErr(e.message ?? 'Помилка створення');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Новий проєкт" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Назва проєкту *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Назва проєкту"
            autoFocus
          />
        </div>
        {err && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl px-3 py-2.5">
            <Ic name="alert" size={15} className="flex-shrink-0 text-red-500" />
            <p className="text-sm">{err}</p>
          </div>
        )}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-blue-600 active:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
        >
          {saving ? 'Створення...' : 'Створити проєкт'}
        </button>
      </form>
    </Modal>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  stats,
  onSelectEmployee,
  onSelectProject,
}: {
  stats: StatsData;
  onSelectEmployee: (id: string) => void;
  onSelectProject: (id: string) => void;
}) {
  const { summary, employees, recentTasks, projects } = stats;

  const top5 = [...employees].sort((a, b) => b.weeklyMinutes - a.weeklyMinutes).slice(0, 5);
  const activeTasks = recentTasks.filter((t) => t.status === 'in_progress');

  return (
    <div className="space-y-6">
      {/* Compact stat row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white rounded-2xl p-3 shadow-sm flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500 flex-shrink-0">
            <Ic name="users" size={16} />
          </div>
          <div>
            <div className="text-xl font-bold text-gray-800 leading-none">{summary.totalEmployees}</div>
            <div className="text-xs text-gray-400 mt-0.5">Співробітники</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-3 shadow-sm flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-500 flex-shrink-0">
            <Ic name="folder" size={16} />
          </div>
          <div>
            <div className="text-xl font-bold text-gray-800 leading-none">{summary.activeProjects}</div>
            <div className="text-xs text-gray-400 mt-0.5">Активні проєкти</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-3 shadow-sm flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center text-amber-500 flex-shrink-0">
            <Ic name="zap" size={16} />
          </div>
          <div>
            <div className="text-xl font-bold text-gray-800 leading-none">{summary.inProgressTasks}</div>
            <div className="text-xs text-gray-400 mt-0.5">В роботі зараз</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-3 shadow-sm flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center text-purple-500 flex-shrink-0">
            <Ic name="check-circle" size={16} />
          </div>
          <div>
            <div className="text-xl font-bold text-gray-800 leading-none">{summary.completedThisWeek}</div>
            <div className="text-xs text-gray-400 mt-0.5">Завершено за тиждень</div>
          </div>
        </div>
      </div>

      {/* Top employees */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <Ic name="trending" size={13} className="text-gray-400" />
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Топ-5 за тиждень</h2>
        </div>
        {top5.length === 0 ? (
          <EmptyState icon="clock" title="Немає даних за цей тиждень" />
        ) : (
          <div className="space-y-1.5">
            {top5.map((emp, i) => (
              <button
                key={emp.id}
                onClick={() => onSelectEmployee(emp.id)}
                className="w-full flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-colors text-left"
              >
                <span className="text-xs font-bold text-gray-300 w-4 text-center tabular-nums flex-shrink-0">{i + 1}</span>
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs flex-shrink-0">
                  {emp.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{emp.name}</p>
                  {emp.username && <p className="text-xs text-gray-400">@{emp.username}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-blue-600 tabular-nums">{fmtTime(emp.weeklyMinutes)}</div>
                  {emp.hourlyRate && emp.weeklyMinutes > 0 && (
                    <div className="text-xs text-emerald-600 font-medium">{fmtMoney(calcEarnings(emp.weeklyMinutes, emp.hourlyRate))}₴</div>
                  )}
                </div>
                <Ic name="chevron" size={14} className="text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Active tasks */}
      {activeTasks.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Активні задачі ({activeTasks.length})</h2>
          </div>
          <div className="space-y-1.5">
            {activeTasks.slice(0, 8).map((t) => (
              <div key={t.id} className="bg-white rounded-xl px-3 py-2.5 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                    <p className="text-xs text-gray-400 truncate">{t.userName} · {t.projectName}</p>
                  </div>
                  {(t.totalMinutes + t.activeMinutes) > 0 && (
                    <span className="text-xs font-semibold text-blue-600 tabular-nums flex-shrink-0">
                      {fmtTime(t.totalMinutes + t.activeMinutes)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Employee Detail View ─────────────────────────────────────────────────────

interface EmployeeDetailProps {
  user: DashUser;
  stats: StatsData | null;
  onBack: () => void;
  onEdit: (id: string, firstName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function EmployeeDetail({ user, stats, onBack, onEdit, onDelete }: EmployeeDetailProps) {
  const empStat = stats?.employees.find((e) => e.id === user.id);
  const tasks = stats?.recentTasks.filter((t) => t.userId === user.id) ?? [];
  const [confirmDelete, setConfirmDelete] = useState(false);

  const totalMinutes = empStat?.weeklyMinutes ?? 0;
  const weeklyEarnings = user.hourly_rate && totalMinutes > 0
    ? fmtMoney(calcEarnings(totalMinutes, user.hourly_rate))
    : null;

  return (
    <div className="space-y-4">
      {/* Back */}
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
        <Ic name="back" size={16} />
        Назад до команди
      </button>

      {/* Profile card */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg flex-shrink-0">
            {(user.first_name ?? user.username ?? '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-800">{displayName(user)}</p>
            {user.username && <p className="text-sm text-gray-400">@{user.username}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="bg-gray-50 rounded-xl p-2.5">
            <p className="text-xs text-gray-400 mb-0.5">Цей тиждень</p>
            <p className="font-semibold text-blue-600">{fmtTime(totalMinutes)}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-2.5">
            <p className="text-xs text-gray-400 mb-0.5">Ставка</p>
            <p className="font-semibold text-gray-700">{user.hourly_rate ? `${user.hourly_rate} ₴/год` : '—'}</p>
          </div>
          {weeklyEarnings !== null && (
            <div className="bg-emerald-50 rounded-xl p-2.5 col-span-2">
              <p className="text-xs text-emerald-600 mb-0.5">Заробіток за тиждень</p>
              <p className="font-bold text-emerald-700">~{weeklyEarnings} ₴</p>
            </div>
          )}
        </div>
      </div>

      {/* Tasks this week */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <Ic name="task" size={13} className="text-gray-400" />
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Задачі за тиждень ({tasks.length})</h2>
        </div>
        {tasks.length === 0 ? (
          <EmptyState icon="clock" title="Немає задач за цей тиждень" />
        ) : (
          <div className="space-y-1.5">
            {tasks.map((t) => {
              const mins = t.totalMinutes + (t.status === 'in_progress' ? t.activeMinutes : 0);
              const earned = user.hourly_rate && mins > 0
                ? fmtMoney(calcEarnings(mins, user.hourly_rate))
                : null;
              return (
                <div key={t.id} className="bg-white rounded-xl px-3 py-2.5 shadow-sm">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-medium text-gray-800 flex-1 min-w-0 leading-snug">{t.name}</p>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Ic name="folder" size={10} />
                      {t.projectName}
                    </span>
                    <span className={`inline-flex items-center gap-1 font-semibold ${mins > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                      <Ic name="timer" size={10} />
                      {fmtTime(mins)}
                    </span>
                    {earned !== null && (
                      <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                        <Ic name="money" size={10} />
                        ~{earned} ₴
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Danger zone */}
      {!confirmDelete ? (
        <button
          onClick={() => setConfirmDelete(true)}
          className="w-full flex items-center justify-center gap-2 text-sm text-red-500 hover:text-red-600 py-2 transition-colors"
        >
          <Ic name="trash" size={14} />
          Видалити співробітника
        </button>
      ) : (
        <div className="bg-red-50 rounded-2xl p-4 space-y-3">
          <p className="text-sm text-red-700 font-medium text-center">Видалити <strong>{displayName(user)}</strong>?</p>
          <div className="flex gap-2">
            <button
              onClick={async () => { await onDelete(user.id); onBack(); }}
              className="flex-1 bg-red-500 text-white py-2.5 rounded-xl text-sm font-medium"
            >
              Видалити
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 bg-white text-gray-700 py-2.5 rounded-xl text-sm border border-gray-200"
            >
              Скасувати
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Team Tab ─────────────────────────────────────────────────────────────────

interface TeamTabProps {
  users: DashUser[];
  stats: StatsData | null;
  authUser: AuthUser;
  initialSelectedId?: string | null;
  onClearSelection?: () => void;
  onAdd: (data: { telegramId?: number; firstName: string; username: string; role: 'admin' | 'employee' }) => Promise<void>;
  onEdit: (id: string, firstName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function TeamTab({ users, stats, authUser, initialSelectedId, onClearSelection, onAdd, onEdit, onDelete }: TeamTabProps) {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(initialSelectedId ?? null);

  // Sync if parent changes initialSelectedId (e.g. from overview click)
  useEffect(() => {
    if (initialSelectedId) setSelectedEmployee(initialSelectedId);
  }, [initialSelectedId]);

  const employees = users.filter((u) => u.role === 'employee');
  const filtered = employees.filter((u) => {
    const q = search.toLowerCase();
    return (
      (u.first_name ?? '').toLowerCase().includes(q) ||
      (u.username ?? '').toLowerCase().includes(q) ||
      String(u.telegram_id).includes(q)
    );
  });

  function getEmpStat(id: string): EmpStat | undefined {
    return stats?.employees.find((e) => e.id === id);
  }

  function startEdit(u: DashUser) {
    setEditingId(u.id);
    setEditName(u.first_name ?? '');
    setEditingRateId(null);
  }

  function startEditRate(u: DashUser) {
    setEditingRateId(u.id);
    setEditRate(u.hourly_rate ? String(u.hourly_rate) : '');
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      await onEdit(id, editName);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  async function saveRate(id: string) {
    setSaving(true);
    try {
      const rate = editRate.trim() === '' ? null : parseFloat(editRate.replace(',', '.'));
      const res = await fetchWithRetry('/api/dashboard/users', {
        method: 'PATCH',
        headers: HEADERS,
        body: JSON.stringify({ id, hourlyRate: rate }),
      });
      if (res.ok) {
        setEditingRateId(null);
      }
    } finally {
      setSaving(false);
    }
  }

  // Show employee detail
  if (selectedEmployee) {
    const emp = users.find((u) => u.id === selectedEmployee);
    if (emp) {
      return (
        <EmployeeDetail
          user={emp}
          stats={stats}
          onBack={() => { setSelectedEmployee(null); onClearSelection?.(); }}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      );
    }
  }

  return (
    <div className="space-y-3">
      {/* Search + Add */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <Ic name="search" size={16} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук за ім'ям, username, ID..."
            className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
          />
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex-shrink-0 bg-blue-600 active:bg-blue-700 text-white font-semibold px-4 py-3 rounded-xl transition-colors flex items-center gap-1.5"
          aria-label="Додати співробітника"
        >
          <Ic name="plus" size={18} />
        </button>
      </div>

      {search && (
        <p className="text-xs text-gray-400 px-1">{filtered.length} з {employees.length} співробітників</p>
      )}

      {filtered.length === 0 && !search ? (
        <EmptyState icon="users" title="Немає співробітників" hint="Натисніть + щоб додати першого співробітника до команди." />
      ) : filtered.length === 0 ? (
        <EmptyState icon="search" title="Нічого не знайдено" hint={`Немає співробітників за запитом «${search}»`} />
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => {
            const empStat = getEmpStat(u.id);
            const isEditing = editingId === u.id;
            const isEditingRate = editingRateId === u.id;

            return (
              <div key={u.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(u.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      className="flex-1 border border-blue-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="Ім'я"
                    />
                    <button onClick={() => saveEdit(u.id)} disabled={saving} className="w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-xl disabled:opacity-50" aria-label="Зберегти">
                      <Ic name="check" size={16} />
                    </button>
                    <button onClick={() => setEditingId(null)} className="w-10 h-10 flex items-center justify-center bg-gray-100 text-gray-600 rounded-xl" aria-label="Скасувати">
                      <Ic name="x" size={16} />
                    </button>
                  </div>
                ) : isEditingRate ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 flex-shrink-0 font-medium">₴/год</span>
                    <input
                      type="number"
                      value={editRate}
                      onChange={(e) => setEditRate(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRate(u.id);
                        if (e.key === 'Escape') setEditingRateId(null);
                      }}
                      autoFocus
                      className="flex-1 border border-emerald-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      placeholder="150"
                    />
                    <button onClick={() => saveRate(u.id)} disabled={saving} className="w-10 h-10 flex items-center justify-center bg-emerald-600 text-white rounded-xl disabled:opacity-50" aria-label="Зберегти ставку">
                      <Ic name="check" size={16} />
                    </button>
                    <button onClick={() => setEditingRateId(null)} className="w-10 h-10 flex items-center justify-center bg-gray-100 text-gray-600 rounded-xl" aria-label="Скасувати">
                      <Ic name="x" size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setSelectedEmployee(u.id)}
                      className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold flex-shrink-0 hover:bg-blue-200 transition-colors"
                    >
                      {(u.first_name ?? u.username ?? '?').charAt(0).toUpperCase()}
                    </button>
                    <button onClick={() => setSelectedEmployee(u.id)} className="flex-1 min-w-0 text-left">
                      <p className="font-medium text-gray-800 truncate">{displayName(u)}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5 flex-wrap">
                        {u.username && <span>@{u.username}</span>}
                        {empStat && empStat.weeklyMinutes > 0 && (
                          <span className="text-blue-500 font-medium inline-flex items-center gap-0.5">
                            <Ic name="clock" size={11} />
                            {fmtTime(empStat.weeklyMinutes)}
                          </span>
                        )}
                        {u.hourly_rate && (
                          <span className="text-emerald-600 font-medium">{u.hourly_rate}₴/год</span>
                        )}
                        {empStat?.activeTasks ? (
                          <span className="inline-flex items-center gap-1 text-blue-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                            активна
                          </span>
                        ) : null}
                      </div>
                    </button>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => startEdit(u)}
                        className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-blue-500 rounded-xl hover:bg-blue-50 transition-colors"
                        title="Редагувати ім'я"
                        aria-label="Редагувати ім'я"
                      >
                        <Ic name="edit" size={15} />
                      </button>
                      <button
                        onClick={() => startEditRate(u)}
                        className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-emerald-500 rounded-xl hover:bg-emerald-50 transition-colors"
                        title="Встановити ставку"
                        aria-label="Встановити ставку"
                      >
                        <Ic name="money" size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <UserModal defaultRole="employee" onClose={() => setShowAdd(false)} onSave={onAdd} />
      )}
    </div>
  );
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        flexShrink: 0,
        cursor: 'pointer',
        transition: 'background 0.2s',
        background: checked ? '#10b981' : '#d1d5db',
        position: 'relative',
        display: 'inline-block',
        outline: 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          transition: 'left 0.2s',
          display: 'block',
        }}
      />
    </div>
  );
}

// ─── Projects Tab ─────────────────────────────────────────────────────────────

interface ProjectsTabProps {
  projects: DashProject[];
  stats: StatsData | null;
  onCreate: (name: string) => Promise<void>;
  onToggle: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function ProjectsTab({ projects, stats, onCreate, onToggle, onDelete }: ProjectsTabProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [recentlyToggled, setRecentlyToggled] = useState<string | null>(null);

  function getProjStat(id: string): ProjStat | undefined {
    return stats?.projects.find((p) => p.id === id);
  }

  async function handleToggle(id: string, isActive: boolean) {
    setRecentlyToggled(id);
    await onToggle(id, isActive);
    setTimeout(() => setRecentlyToggled(null), 700);
  }

  const sorted = [...projects].sort((a, b) => {
    if (a.is_active === b.is_active) return a.name.localeCompare(b.name, 'uk');
    return a.is_active ? -1 : 1;
  });

  const filtered = sorted.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {/* Search + Add — identical to TeamTab */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <Ic name="search" size={16} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук проєктів..."
            className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
          />
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex-shrink-0 bg-blue-600 active:bg-blue-700 text-white font-semibold px-4 py-3 rounded-xl transition-colors flex items-center gap-1.5"
          aria-label="Створити проєкт"
        >
          <Ic name="plus" size={18} />
        </button>
      </div>

      {search && (
        <p className="text-xs text-gray-400 px-1">{filtered.length} з {projects.length} проєктів</p>
      )}

      {filtered.length === 0 && !search ? (
        <EmptyState
          icon="folder"
          title="Немає проєктів"
          hint="Натисніть + щоб створити перший проєкт."
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="search" title="Нічого не знайдено" hint={`Немає проєктів за запитом «${search}»`} />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const pStat = getProjStat(p.id);
            const isConfirming = confirmDelete === p.id;

            return (
              <div
                key={p.id}
                className={`bg-white rounded-2xl px-4 py-3 shadow-sm transition-all duration-300 ${
                  !p.is_active ? 'opacity-60' : ''
                } ${recentlyToggled === p.id ? 'animate-highlight' : ''}`}
              >
                <div className="flex items-center gap-3">
                  {/* Folder avatar — open when active, closed when inactive */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${p.is_active ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                    <Ic name={p.is_active ? 'folder' : 'folder-closed'} size={18} />
                  </div>

                  {/* Name + stats */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-800 truncate">{p.name}</p>
                      {!p.is_active && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Неактивний</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                      {pStat && (
                        <span className="inline-flex items-center gap-1">
                          <Ic name="task" size={11} />
                          {pStat.taskCount} задач
                        </span>
                      )}
                      {pStat && pStat.totalMinutes > 0 && (
                        <span className="inline-flex items-center gap-1 text-blue-500 font-medium">
                          <Ic name="timer" size={11} />
                          {fmtTime(pStat.totalMinutes)}
                        </span>
                      )}
                      {pStat && pStat.activeCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          {pStat.activeCount} активних
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {!isConfirming && (
                    <div className="flex items-center gap-2">
                      <ToggleSwitch
                        checked={p.is_active}
                        onChange={(v) => handleToggle(p.id, v)}
                        label={p.is_active ? 'Деактивувати проєкт' : 'Активувати проєкт'}
                      />
                      <button
                        onClick={() => setConfirmDelete(p.id)}
                        className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-red-500 rounded-xl hover:bg-red-50 transition-colors"
                        title="Видалити проєкт"
                        aria-label="Видалити проєкт"
                      >
                        <Ic name="trash" size={15} />
                      </button>
                    </div>
                  )}
                </div>

                {isConfirming && (
                  <div className="mt-3 flex items-center gap-2 justify-end border-t border-gray-100 pt-3">
                    <p className="text-sm text-gray-600 flex-1">Видалити <strong>{p.name}</strong>?</p>
                    <button
                      onClick={async () => { await onDelete(p.id); setConfirmDelete(null); }}
                      className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                    >
                      Видалити
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm transition-colors"
                    >
                      Скасувати
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <ProjectModal onClose={() => setShowCreate(false)} onSave={onCreate} />
      )}
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({ task: t, displayMinutes, users }: { task: TaskStat; displayMinutes: number; users: DashUser[] }) {
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const hasAttachments = t.attachments && t.attachments.length > 0;

  // Find the employee to get their hourly rate
  const employee = users.find((u) => u.id === t.userId);
  const taskEarnings = employee?.hourly_rate && displayMinutes > 0
    ? fmtMoney(calcEarnings(displayMinutes, employee.hourly_rate))
    : null;

  // Separate comments from files
  const comments = t.attachments?.filter((a) => a.type === 'text') ?? [];
  const files = t.attachments?.filter((a) => a.type === 'file') ?? [];

  // Parse file content "filename\nurl"
  const parseFile = (content: string) => {
    const nl = content.indexOf('\n');
    const fileName = nl !== -1 ? content.slice(0, nl).trim() : 'Файл';
    const url = nl !== -1 ? content.slice(nl + 1).trim() : content;
    const isImage = /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(fileName);
    // Clean up auto-generated photo names for display
    const displayName = /^photo_\d+\.jpg$/i.test(fileName) ? 'Фото' : fileName;
    return { fileName, displayName, url, isImage };
  };

  const imageFiles = files.map((f) => parseFile(f.content)).filter((f) => f.isImage);
  const docFiles = files.map((f) => parseFile(f.content)).filter((f) => !f.isImage);

  return (
    <>
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Preview"
            className="max-w-full max-h-full rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
            aria-label="Закрити"
          >
            <Ic name="x" size={18} />
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl px-4 py-3 shadow-sm">
        {/* Title + status */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="font-medium text-gray-800 flex-1 min-w-0 leading-snug">{t.name}</p>
          <StatusBadge status={t.status} />
        </div>

        {/* Person + project */}
        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Ic name="person" size={11} />
            {t.userName}
          </span>
          <span className="inline-flex items-center gap-1">
            <Ic name="folder" size={11} />
            {t.projectName}
          </span>
        </div>

        {/* Time + salary */}
        <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
          <span className={`inline-flex items-center gap-1 font-semibold ${displayMinutes > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
            <Ic name="timer" size={11} />
            {fmtTime(displayMinutes)}
            {t.status === 'in_progress' && t.activeMinutes > 0 && (
              <span className="text-blue-400 font-normal">(зараз)</span>
            )}
          </span>
          {taskEarnings !== null && (
            <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
              <Ic name="money" size={11} />
              ~{taskEarnings} ₴
            </span>
          )}
          {t.logCount > 1 && (
            <span className="inline-flex items-center gap-1 text-gray-400">
              <Ic name="history" size={11} />
              {t.logCount} інтервалів
            </span>
          )}
        </div>

        {/* Dates */}
        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Ic name="play" size={10} />
            {fmtDate(t.startedAt)}
          </span>
          {t.completedAt && (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <Ic name="check" size={10} />
              {fmtDate(t.completedAt)}
            </span>
          )}
        </div>

        {/* Attachments */}
        {hasAttachments && (
          <div className="mt-3 border-t border-gray-100 pt-3 space-y-3">

            {/* Comments — always visible */}
            {comments.map((a) => (
              <div key={a.id} className="flex items-start gap-2">
                <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs">💬</span>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed break-words flex-1">
                  {a.content.replace(/^💬\s*/, '')}
                </p>
              </div>
            ))}

            {/* Image grid — tap to open lightbox */}
            {imageFiles.length > 0 && (
              <div className={`grid gap-1.5 ${imageFiles.length === 1 ? 'grid-cols-1' : imageFiles.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {imageFiles.map((f, i) => (
                  <button
                    key={i}
                    onClick={() => setLightbox(f.url)}
                    className="relative overflow-hidden rounded-xl bg-gray-100 aspect-square focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label={`Відкрити ${f.displayName}`}
                  >
                    <img
                      src={f.url}
                      alt={f.displayName}
                      className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                      loading="lazy"
                      onError={(e) => {
                        const el = e.target as HTMLImageElement;
                        el.style.display = 'none';
                        el.parentElement!.innerHTML = '<span class="text-2xl flex items-center justify-center h-full">🖼️</span>';
                      }}
                    />
                    {/* Zoom hint on hover */}
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center">
                      <div className="opacity-0 hover:opacity-100 transition-opacity bg-black/50 rounded-full p-1.5">
                        <Ic name="search" size={14} className="text-white" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Document files */}
            {docFiles.length > 0 && (
              <div className="space-y-1.5">
                {docFiles.map((f, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      const tg = (window as any).Telegram?.WebApp;
                      if (tg?.openLink) {
                        tg.openLink(f.url);
                      } else {
                        window.open(f.url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors group text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Ic name="task" size={16} className="text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{f.displayName}</p>
                      <p className="text-xs text-gray-400">Натисніть щоб відкрити</p>
                    </div>
                    <Ic name="back" size={14} className="text-gray-400 group-hover:text-blue-500 rotate-[-90deg] transition-colors flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Tasks Tab ────────────────────────────────────────────────────────────────

function TasksTab({ tasks, users }: { tasks: TaskStat[]; users: DashUser[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStat['status']>('all');

  const filtered = tasks.filter((t) => {
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch =
      t.name.toLowerCase().includes(q) ||
      t.userName.toLowerCase().includes(q) ||
      t.projectName.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const chips: { key: 'all' | TaskStat['status']; label: string; icon: IconName }[] = [
    { key: 'all',         label: 'Всі',       icon: 'list' },
    { key: 'in_progress', label: 'В роботі',  icon: 'play' },
    { key: 'paused',      label: 'Пауза',     icon: 'pause' },
    { key: 'completed',   label: 'Завершено', icon: 'check-circle' },
  ];

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <Ic name="search" size={16} />
        </span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Пошук задач, людини, проєкту..."
          className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
        />
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setStatusFilter(c.key)}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-full transition-colors ${
              statusFilter === c.key
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            <Ic name={c.icon} size={13} />
            {c.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-400 px-1">{filtered.length} задач</p>

      {filtered.length === 0 && !search && statusFilter === 'all' ? (
        <EmptyState icon="task" title="Немає задач" hint="Задачі з'являться тут після того, як співробітники почнуть роботу через бота." />
      ) : filtered.length === 0 ? (
        <EmptyState icon="search" title="Нічого не знайдено" hint="Спробуйте змінити фільтр або пошуковий запит." />
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const displayMinutes = t.totalMinutes + (t.status === 'in_progress' ? t.activeMinutes : 0);
            return (
              <TaskCard key={t.id} task={t} displayMinutes={displayMinutes} users={users} />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Admins Tab ───────────────────────────────────────────────────────────────

interface AdminsTabProps {
  users: DashUser[];
  authUser: AuthUser;
  onAdd: (data: { telegramId?: number; firstName: string; username: string; role: 'admin' | 'employee' }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function AdminsTab({ users, authUser, onAdd, onDelete }: AdminsTabProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const admins = users.filter((u) => u.role === 'admin');
  const filtered = admins.filter((u) => {
    const q = search.toLowerCase();
    return (
      (u.first_name ?? '').toLowerCase().includes(q) ||
      (u.username ?? '').toLowerCase().includes(q) ||
      String(u.telegram_id).includes(q)
    );
  });

  return (
    <div className="space-y-3">
      {/* Search + Add — identical pattern */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <Ic name="search" size={16} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук за ім'ям, username, ID..."
            className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
          />
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex-shrink-0 bg-blue-600 active:bg-blue-700 text-white font-semibold px-4 py-3 rounded-xl transition-colors flex items-center gap-1.5"
          aria-label="Додати адміна"
        >
          <Ic name="plus" size={18} />
        </button>
      </div>

      {search && (
        <p className="text-xs text-gray-400 px-1">{filtered.length} з {admins.length} адміністраторів</p>
      )}

      {filtered.length === 0 && !search ? (
        <EmptyState icon="key" title="Немає адміністраторів" hint="Натисніть + щоб додати першого адміністратора." />
      ) : filtered.length === 0 ? (
        <EmptyState icon="search" title="Нічого не знайдено" hint={`Немає адміністраторів за запитом «${search}»`} />
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => {
            const isSelf = u.telegram_id === authUser.telegram_id;
            const isConfirming = confirmDelete === u.id;

            return (
              <div key={u.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-semibold text-sm flex-shrink-0">
                    {(u.first_name ?? u.username ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-800 truncate">{displayName(u)}</p>
                      {isSelf && (
                        <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-medium">Ви</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                      {u.username && <span>@{u.username}</span>}
                      <span>ID: {u.telegram_id}</span>
                    </div>
                  </div>
                  {!isConfirming && !isSelf && (
                    <button
                      onClick={() => setConfirmDelete(u.id)}
                      className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-red-500 rounded-xl hover:bg-red-50 transition-colors"
                      title="Видалити адміна"
                      aria-label="Видалити адміна"
                    >
                      <Ic name="trash" size={15} />
                    </button>
                  )}
                  {isSelf && (
                    <div className="w-9 h-9 flex items-center justify-center text-gray-300" title="Не можна видалити себе">
                      <Ic name="lock" size={15} />
                    </div>
                  )}
                </div>

                {isConfirming && (
                  <div className="mt-3 flex items-center gap-2 justify-end border-t border-gray-100 pt-3">
                    <p className="text-sm text-gray-600 flex-1">Видалити <strong>{displayName(u)}</strong>?</p>
                    <button
                      onClick={async () => { await onDelete(u.id); setConfirmDelete(null); }}
                      className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                    >
                      Видалити
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm transition-colors"
                    >
                      Скасувати
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <UserModal defaultRole="admin" onClose={() => setShowAdd(false)} onSave={onAdd} />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [authState, setAuthState] = useState<'loading' | 'denied' | 'ok'>('loading');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [statsErrorTime, setStatsErrorTime] = useState<Date | undefined>();
  const [statsIsNetwork, setStatsIsNetwork] = useState(false);

  const [users, setUsers] = useState<DashUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [usersErrorTime, setUsersErrorTime] = useState<Date | undefined>();
  const [usersIsNetwork, setUsersIsNetwork] = useState(false);

  const [projects, setProjects] = useState<DashProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  const [projectsErrorTime, setProjectsErrorTime] = useState<Date | undefined>();
  const [projectsIsNetwork, setProjectsIsNetwork] = useState(false);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let telegramId: number | null = null;

    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user?.id) {
      telegramId = tg.initDataUnsafe.user.id;
      tg.ready?.();
      tg.expand?.();
    }

    if (!telegramId) {
      const params = new URLSearchParams(window.location.search);
      const tid = params.get('tid');
      if (tid) telegramId = Number(tid);
    }

    if (!telegramId) {
      setAuthState('denied');
      setAuthError('no_tid');
      return;
    }

    fetchWithRetry('/api/dashboard/auth', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ telegramId }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.ok || data.user?.role !== 'admin') {
          // If they're not an admin, redirect employees to the timer miniapp
          if (telegramId) {
            window.location.replace(`/app?tid=${telegramId}`);
          } else {
            setAuthState('denied');
            setAuthError(data.error ?? 'not_admin');
          }
        } else {
          setAuthUser(data.user);
          setAuthState('ok');
        }
      })
      .catch(() => {
        setAuthState('denied');
        setAuthError('network');
      });
  }, []);

  // ── Data fetchers ─────────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError('');
    setStatsIsNetwork(false);
    try {
      const res = await fetchWithRetry('/api/dashboard/stats', { headers: HEADERS });
      if (!res.ok) throw new Error(`Сервер повернув помилку ${res.status}`);
      const data = await res.json();
      setStats(data);
    } catch (e: any) {
      const isNet = e instanceof TypeError || e.message?.includes('fetch');
      setStatsIsNetwork(isNet);
      setStatsError(isNet ? 'Не вдалося підключитися до сервера' : (e.message ?? 'Невідома помилка'));
      setStatsErrorTime(new Date());
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError('');
    setUsersIsNetwork(false);
    try {
      const res = await fetchWithRetry('/api/dashboard/users', { headers: HEADERS });
      if (!res.ok) throw new Error(`Сервер повернув помилку ${res.status}`);
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch (e: any) {
      const isNet = e instanceof TypeError || e.message?.includes('fetch');
      setUsersIsNetwork(isNet);
      setUsersError(isNet ? 'Не вдалося підключитися до сервера' : (e.message ?? 'Невідома помилка'));
      setUsersErrorTime(new Date());
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError('');
    setProjectsIsNetwork(false);
    try {
      const res = await fetchWithRetry('/api/dashboard/projects', { headers: HEADERS });
      if (!res.ok) throw new Error(`Сервер повернув помилку ${res.status}`);
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch (e: any) {
      const isNet = e instanceof TypeError || e.message?.includes('fetch');
      setProjectsIsNetwork(isNet);
      setProjectsError(isNet ? 'Не вдалося підключитися до сервера' : (e.message ?? 'Невідома помилка'));
      setProjectsErrorTime(new Date());
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (authState !== 'ok') return;
    fetchStats();
    fetchUsers();
    fetchProjects();
  }, [authState, fetchStats, fetchUsers, fetchProjects]);

  // ── Refresh all ───────────────────────────────────────────────────────────

  function refreshAll() {
    fetchStats();
    fetchUsers();
    fetchProjects();
  }

  // ── User mutations ────────────────────────────────────────────────────────

  async function handleAddUser(data: { telegramId?: number; firstName: string; username: string; role: 'admin' | 'employee' }) {
    const res = await fetchWithRetry('/api/dashboard/users', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        telegramId: data.telegramId,
        firstName: data.firstName || undefined,
        username: data.username || undefined,
        role: data.role,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Помилка додавання користувача');
    setUsers((prev) => [json.user, ...prev]);
    fetchStats();
  }

  async function handleEditUser(id: string, firstName: string) {
    const res = await fetchWithRetry('/api/dashboard/users', {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ id, firstName: firstName || null }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Помилка редагування');
    setUsers((prev) => prev.map((u) => (u.id === id ? json.user : u)));
  }

  async function handleDeleteUser(id: string) {
    setUsers((prev) => prev.filter((u) => u.id !== id));
    const res = await fetchWithRetry('/api/dashboard/users', {
      method: 'DELETE',
      headers: HEADERS,
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      fetchUsers();
    } else {
      fetchStats();
    }
  }

  // ── Project mutations ─────────────────────────────────────────────────────

  async function handleCreateProject(name: string) {
    const res = await fetchWithRetry('/api/dashboard/projects', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ name }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Помилка створення проєкту');
    setProjects((prev) => [json.project, ...prev]);
    fetchStats();
  }

  async function handleToggleProject(id: string, isActive: boolean) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, is_active: isActive } : p)));
    const res = await fetchWithRetry('/api/dashboard/projects', {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ id, is_active: isActive }),
    });
    if (!res.ok) {
      fetchProjects();
    } else {
      fetchStats();
    }
  }

  async function handleDeleteProject(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    const res = await fetchWithRetry('/api/dashboard/projects', {
      method: 'DELETE',
      headers: HEADERS,
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      fetchProjects();
    } else {
      fetchStats();
    }
  }

  // ── Auth screens ──────────────────────────────────────────────────────────

  if (authState === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-500">Перевірка доступу...</p>
        </div>
      </div>
    );
  }

  if (authState === 'denied') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4 text-red-500">
            <Ic name="lock" size={32} />
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Доступ заборонено</h1>
          {authError === 'no_tid' ? (
            <p className="text-sm text-gray-500">
              Відкрийте цю сторінку через бота. Посилання повинно містити ваш Telegram ID.
            </p>
          ) : authError === 'network' ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-500">Помилка мережі під час перевірки доступу.</p>
              <p className="text-xs text-gray-400">Перевірте з'єднання та перезавантажте сторінку.</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              У вас немає прав адміністратора. Зверніться до власника бота.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Tab definitions ───────────────────────────────────────────────────────

  const tabs: { key: Tab; icon: IconName; label: string }[] = [
    { key: 'overview', icon: 'chart',   label: 'Огляд' },
    { key: 'team',     icon: 'users',   label: 'Команда' },
    { key: 'projects', icon: 'folder',  label: 'Проєкти' },
    { key: 'tasks',    icon: 'task',    label: 'Задачі' },
    { key: 'admins',   icon: 'key',     label: 'Адміни' },
  ];

  const isLoading = statsLoading || usersLoading || projectsLoading;

  // ── Tab content ───────────────────────────────────────────────────────────

  function renderTabContent() {
    if (activeTab === 'overview') {
      if (statsLoading && !stats) return (
        <div className="space-y-6">
          <SkeletonStatCards />
          <SkeletonList count={3} />
        </div>
      );
      if (statsError) return (
        <ErrorState
          endpoint="/api/dashboard/stats"
          message={statsError}
          isNetwork={statsIsNetwork}
          onRetry={fetchStats}
          errorTime={statsErrorTime}
        />
      );
      if (!stats) return (
        <div className="space-y-6">
          <SkeletonStatCards />
          <SkeletonList count={3} />
        </div>
      );
      return <OverviewTab stats={stats} onSelectEmployee={(id) => { setSelectedEmployeeId(id); setActiveTab('team'); }} onSelectProject={(id) => { setActiveTab('projects'); }} />;
    }

    if (activeTab === 'team') {
      if (usersLoading && users.length === 0) return <SkeletonList count={5} />;
      if (usersError) return (
        <ErrorState
          endpoint="/api/dashboard/users"
          message={usersError}
          isNetwork={usersIsNetwork}
          onRetry={fetchUsers}
          errorTime={usersErrorTime}
        />
      );
      return (
        <TeamTab
          users={users}
          stats={stats}
          authUser={authUser!}
          initialSelectedId={selectedEmployeeId}
          onClearSelection={() => setSelectedEmployeeId(null)}
          onAdd={handleAddUser}
          onEdit={handleEditUser}
          onDelete={handleDeleteUser}
        />
      );
    }

    if (activeTab === 'projects') {
      if (projectsLoading && projects.length === 0) return <SkeletonList count={4} />;
      if (projectsError) return (
        <ErrorState
          endpoint="/api/dashboard/projects"
          message={projectsError}
          isNetwork={projectsIsNetwork}
          onRetry={fetchProjects}
          errorTime={projectsErrorTime}
        />
      );
      return (
        <ProjectsTab
          projects={projects}
          stats={stats}
          onCreate={handleCreateProject}
          onToggle={handleToggleProject}
          onDelete={handleDeleteProject}
        />
      );
    }

    if (activeTab === 'tasks') {
      if (statsLoading && !stats) return <SkeletonList count={5} />;
      if (statsError) return (
        <ErrorState
          endpoint="/api/dashboard/stats"
          message={statsError}
          isNetwork={statsIsNetwork}
          onRetry={fetchStats}
          errorTime={statsErrorTime}
        />
      );
      return <TasksTab tasks={stats?.recentTasks ?? []} users={users} />;
    }

    if (activeTab === 'admins') {
      if (usersLoading && users.length === 0) return <SkeletonList count={3} />;
      if (usersError) return (
        <ErrorState
          endpoint="/api/dashboard/users"
          message={usersError}
          isNetwork={usersIsNetwork}
          onRetry={fetchUsers}
          errorTime={usersErrorTime}
        />
      );
      return (
        <AdminsTab
          users={users}
          authUser={authUser!}
          onAdd={handleAddUser}
          onDelete={handleDeleteUser}
        />
      );
    }

    return null;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-900 text-base">U:DO Work</span>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Адмін</span>
          </div>
          <div className="flex items-center gap-3">
            {authUser?.first_name && (
              <span className="text-xs text-gray-500 hidden sm:block truncate max-w-[120px]">
                {authUser.first_name}
              </span>
            )}
            <button
              onClick={refreshAll}
              disabled={isLoading}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-40"
              title="Оновити дані"
              aria-label="Оновити дані"
            >
              <Ic name="refresh" size={18} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 pb-32">
        {renderTabContent()}
      </main>

      {/* Bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-100 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Навігація"
      >
        <div className="max-w-2xl mx-auto flex px-2 pt-2 pb-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              aria-current={activeTab === t.key ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-1.5 py-2 rounded-2xl transition-all duration-200 ${
                activeTab === t.key
                  ? 'text-blue-600'
                  : 'text-gray-400 active:text-gray-600'
              }`}
            >
              <div className={`flex items-center justify-center w-12 h-8 rounded-2xl transition-all duration-200 ${
                activeTab === t.key ? 'bg-blue-50' : ''
              }`}>
                <Ic name={t.icon} size={22} />
              </div>
              <span className={`text-[11px] font-semibold leading-none tracking-tight transition-colors ${
                activeTab === t.key ? 'text-blue-600' : 'text-gray-400'
              }`}>{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
