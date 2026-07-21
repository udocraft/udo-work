"use client";

import { useEffect, useState, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project { id: string; name: string; }

interface ActiveTask {
  id: string;
  name: string;
  projectId: string;
  status: "in_progress" | "paused" | "completed";
  createdAt: string;
}

interface TimeLog {
  id: string;
  task_id: string;
  started_at: string;
  paused_at: string | null;
  ended_at: string | null;
}

interface TodayTask {
  taskId?: string;
  taskName: string;
  projectName: string;
  status: string;
  timeSpent: { hours: number; minutes: number; totalMinutes: number };
  attachments?: { type: string; content: string }[];
}

interface TimerState {
  user: { id: string; name: string; hourlyRate?: number | null; role: "employee" | "admin" } | null;
  activeTask: ActiveTask | null;
  timeLogs: TimeLog[];
  projects: Project[];
  todayTasks: TodayTask[];
}

interface UploadedFile {
  name: string;
  status: "uploading" | "done" | "error";
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcElapsedSeconds(timeLogs: TimeLog[]): number {
  let total = 0;
  for (const log of timeLogs) {
    const end = log.paused_at ?? log.ended_at;
    if (!end) {
      total += Math.floor((Date.now() - new Date(log.started_at).getTime()) / 1000);
    } else {
      const diff = Math.floor((new Date(end).getTime() - new Date(log.started_at).getTime()) / 1000);
      if (diff > 0) total += diff;
    }
  }
  return total;
}

function formatHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatTotalTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}г ${m}хв`;
  return `${m}хв`;
}

// ---------------------------------------------------------------------------
// Loading screen
// ---------------------------------------------------------------------------

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-5 px-6">
      <div className="relative flex items-center justify-center">
        <span className="absolute inline-flex h-16 w-16 rounded-full bg-blue-500 opacity-20 animate-ping" />
        <span className="relative inline-flex h-12 w-12 rounded-full bg-blue-600 items-center justify-center text-2xl">⏱</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="text-white text-sm font-semibold tracking-wide">U:DO Work</div>
        <div className="text-slate-500 text-xs">Завантаження...</div>
      </div>
      <div className="w-32 h-0.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full animate-loading-bar" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin redirect view
// ---------------------------------------------------------------------------

function AdminRedirectView({ name, telegramId }: { name: string; telegramId: number }) {
  const dashboardUrl = `/dashboard?tid=${telegramId}`;
  const firstName = name.split(" ")[0];
  useEffect(() => { window.location.replace(dashboardUrl); }, [dashboardUrl]);
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center px-6 gap-5 animate-fade-in" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-3xl shadow-lg shadow-blue-900/40">🛡️</div>
      <div className="text-center">
        <div className="text-xl font-bold">Привіт, {firstName}!</div>
        <div className="text-sm text-slate-400 mt-1">Переходимо до панелі адміністратора...</div>
      </div>
      <div className="w-32 h-0.5 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full animate-loading-bar" />
      </div>
      <button onClick={() => window.location.replace(dashboardUrl)} className="mt-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition-colors">
        Відкрити зараз →
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Complete task panel — multi-step: results → attachments → preview → submit
// ---------------------------------------------------------------------------

interface CompletePanelProps {
  taskId: string;
  taskName: string;
  projectName: string;
  elapsedSeconds: number;
  telegramId: number;
  onDone: () => void;
}

const RESULT_EXAMPLES = [
  "Зверстав макет головної сторінки",
  "Виправив баг з авторизацією",
  "Написав тести для модуля оплати",
  "Провів зустріч з клієнтом",
];

function CompletePanel({ taskId, taskName, projectName, elapsedSeconds, telegramId, onDone }: CompletePanelProps) {
  const [step, setStep] = useState<"results" | "attachments" | "preview">("results");
  const [resultText, setResultText] = useState("");
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    const key = `${file.name}-${file.size}`;
    setUploads((prev) => [...prev, { name: file.name, status: "uploading" }]);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("taskId", taskId);
    fd.append("telegramId", String(telegramId));
    try {
      const res = await fetch("/api/app/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error === "file_too_large" ? "Файл > 20 МБ" : "Помилка";
        setUploads((prev) => prev.map((u) => u.name === file.name ? { ...u, status: "error", error: msg } : u));
      } else {
        setUploads((prev) => prev.map((u) => u.name === file.name ? { ...u, status: "done" } : u));
      }
    } catch {
      setUploads((prev) => prev.map((u) => u.name === file.name ? { ...u, status: "error", error: "Мережа" } : u));
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(uploadFile);
  };

  const removeUpload = (name: string) => {
    setUploads((prev) => prev.filter((u) => u.name !== name));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (resultText.trim()) {
        await fetch("/api/app/timer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegramId, action: "attach_comment", taskId, comment: resultText.trim() }),
        });
      }
      // Fire admin notification with all attachments (comment + uploaded files)
      await fetch("/api/app/timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, action: "notify_complete", taskId }),
      });
      setSubmitted(true);
      setTimeout(onDone, 1400);
    } finally {
      setSubmitting(false);
    }
  };

  const uploadingCount = uploads.filter((u) => u.status === "uploading").length;
  const doneCount = uploads.filter((u) => u.status === "done").length;

  if (submitted) {
    return (
      <section className="w-full bg-slate-800 rounded-2xl p-6 flex flex-col items-center gap-3 animate-fade-in">
        <div className="text-5xl">🎉</div>
        <div className="text-base font-semibold text-green-400">Задачу завершено!</div>
        <div className="text-xs text-slate-400 text-center">{taskName}</div>
      </section>
    );
  }

  // ── Step 1: Results ──────────────────────────────────────────────────────
  if (step === "results") {
    return (
      <section className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col gap-4 animate-fade-in">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">1</div>
          <div>
            <div className="text-sm font-semibold">Що зроблено?</div>
            <div className="text-xs text-slate-400">{taskName} · {projectName}</div>
          </div>
        </div>

        <textarea
          value={resultText}
          onChange={(e) => setResultText(e.target.value)}
          placeholder="Опишіть результат роботи..."
          rows={3}
          autoFocus
          className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
        />

        {/* Quick-fill examples */}
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-slate-500">Приклади:</div>
          <div className="flex flex-wrap gap-1.5">
            {RESULT_EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setResultText(ex)}
                className="text-xs px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={() => setStep("attachments")}
            disabled={!resultText.trim()}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors"
          >
            Далі →
          </button>
          <button
            onClick={() => setStep("attachments")}
            className="px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm text-slate-400 transition-colors"
          >
            Пропустити
          </button>
        </div>
      </section>
    );
  }

  // ── Step 2: Attachments ──────────────────────────────────────────────────
  if (step === "attachments") {
    return (
      <section className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col gap-4 animate-fade-in">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">2</div>
          <div>
            <div className="text-sm font-semibold">Додати файли?</div>
            <div className="text-xs text-slate-400">Фото, скріншоти, документи</div>
          </div>
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-3 border-2 border-dashed border-slate-600 rounded-xl text-sm text-slate-400 hover:border-blue-500 hover:text-blue-400 transition-colors flex items-center justify-center gap-2"
        >
          <span className="text-lg">+</span> Вибрати файли
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip,.txt"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {uploads.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {uploads.map((u, i) => (
              <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs ${
                u.status === "done" ? "bg-green-900/40 text-green-400"
                : u.status === "error" ? "bg-red-900/40 text-red-400"
                : "bg-slate-700 text-slate-400"
              }`}>
                <span className="flex-shrink-0">{u.status === "done" ? "✅" : u.status === "error" ? "❌" : "⏳"}</span>
                <span className="truncate flex-1">{u.name}</span>
                {u.status !== "uploading" && (
                  <button onClick={() => removeUpload(u.name)} className="flex-shrink-0 text-slate-500 hover:text-red-400 transition-colors">✕</button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={() => setStep("preview")}
            disabled={uploadingCount > 0}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors"
          >
            {uploadingCount > 0 ? `Завантаження ${uploadingCount}...` : "Далі →"}
          </button>
          <button
            onClick={() => setStep("results")}
            className="px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm text-slate-400 transition-colors"
          >
            ← Назад
          </button>
        </div>
      </section>
    );
  }

  // ── Step 3: Preview ──────────────────────────────────────────────────────
  return (
    <section className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center text-xs font-bold flex-shrink-0">✓</div>
        <div className="text-sm font-semibold">Перевірте перед відправкою</div>
      </div>

      {/* Task info */}
      <div className="bg-slate-700/60 rounded-xl p-3 flex flex-col gap-1">
        <div className="text-xs text-slate-400">Задача</div>
        <div className="text-sm font-medium text-white">{taskName}</div>
        <div className="text-xs text-slate-400">{projectName} · {formatHMS(elapsedSeconds)}</div>
      </div>

      {/* Result */}
      {resultText.trim() ? (
        <div className="bg-slate-700/60 rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-slate-400">Результат</div>
            <button onClick={() => setStep("results")} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Змінити</button>
          </div>
          <div className="text-sm text-white leading-relaxed">{resultText}</div>
        </div>
      ) : (
        <button onClick={() => setStep("results")} className="text-xs text-slate-500 hover:text-blue-400 transition-colors text-left">
          + Додати опис результату
        </button>
      )}

      {/* Attachments */}
      {doneCount > 0 ? (
        <div className="bg-slate-700/60 rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-slate-400">Вкладення ({doneCount})</div>
            <button onClick={() => setStep("attachments")} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Змінити</button>
          </div>
          <div className="flex flex-col gap-1">
            {uploads.filter((u) => u.status === "done").map((u, i) => (
              <div key={i} className="text-xs text-green-400 flex items-center gap-1.5">
                <span>📎</span><span className="truncate">{u.name}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button onClick={() => setStep("attachments")} className="text-xs text-slate-500 hover:text-blue-400 transition-colors text-left">
          + Додати файли або фото
        </button>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors"
      >
        {submitting ? "Збереження..." : "✅ Надіслати та завершити"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AppPage() {
  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [state, setState] = useState<TimerState>({
    user: null, activeTask: null, timeLogs: [], projects: [], todayTasks: [],
  });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showNewTask, setShowNewTask] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");
  const [taskName, setTaskName] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // After completing — show attachment panel for the just-completed task
  const [completedTask, setCompletedTask] = useState<{ id: string; name: string; projectName: string; elapsedSeconds: number } | null>(null);

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let tid: number | null = null;
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      if (tg.initDataUnsafe?.user?.id) tid = tg.initDataUnsafe.user.id;
    }
    if (!tid) {
      const p = new URLSearchParams(window.location.search).get("tid");
      if (p) tid = Number(p);
    }
    if (tid) setTelegramId(tid);
    else setError("Не вдалося визначити користувача. Відкрийте через Telegram.");
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch state
  // ---------------------------------------------------------------------------
  const fetchState = useCallback(async (tid: number) => {
    try {
      const res = await fetch(`/api/app/timer?telegramId=${tid}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Помилка завантаження");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setState(data);
      setError(null);
      setElapsedSeconds(data.activeTask ? calcElapsedSeconds(data.timeLogs) : 0);
    } catch {
      setError("Помилка мережі");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (telegramId) fetchState(telegramId);
  }, [telegramId, fetchState]);

  // ---------------------------------------------------------------------------
  // Live timer tick
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (state.activeTask?.status !== "in_progress") return;
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [state.activeTask?.status]);

  // ---------------------------------------------------------------------------
  // API actions
  // ---------------------------------------------------------------------------
  const doAction = useCallback(async (action: string, extra?: Record<string, string>) => {
    if (!telegramId) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/app/timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msgs: Record<string, string> = {
          active_task_exists: "У вас вже є активна задача.",
          no_active_task: "Немає активної задачі.",
          no_paused_task: "Немає задачі на паузі.",
        };
        setError(msgs[data.error] ?? data.error ?? "Помилка");
        return;
      }
      setError(null);
      return data;
    } catch {
      setError("Помилка мережі");
    } finally {
      setActionLoading(false);
    }
  }, [telegramId]);

  const handleStart = async () => {
    if (!selectedProject || !taskName.trim()) return;
    await doAction("start", { projectId: selectedProject, taskName: taskName.trim() });
    setShowNewTask(false);
    setTaskName("");
    setSelectedProject("");
    if (telegramId) fetchState(telegramId);
  };

  const handleComplete = async () => {
    if (!state.activeTask) return;
    const taskInfo = {
      id: state.activeTask.id,
      name: state.activeTask.name,
      projectName: state.projects.find((p) => p.id === state.activeTask!.projectId)?.name ?? "",
      elapsedSeconds,
    };
    const result = await doAction("complete");
    if (result?.ok) {
      setCompletedTask(taskInfo);
      if (telegramId) fetchState(telegramId);
    }
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const task = state.activeTask;
  const isRunning = task?.status === "in_progress";
  const isPaused = task?.status === "paused";
  const hasTask = !!task;
  const projectName = state.projects.find((p) => p.id === task?.projectId)?.name ?? "";
  const todayTotalMin = state.todayTasks.reduce((s, t) => s + t.timeSpent.totalMinutes, 0);

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  if (loading) return <LoadingScreen />;

  if (error && !state.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6 animate-fade-in">
        <div className="text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <div className="text-white text-base">{error}</div>
        </div>
      </div>
    );
  }

  if (state.user?.role === "admin") {
    return <AdminRedirectView name={state.user.name} telegramId={telegramId!} />;
  }

  // ---------------------------------------------------------------------------
  // Employee view
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col animate-fade-in">
      {/* Header */}
      <header className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wider">Таймер</div>
          <div className="text-sm font-semibold text-white truncate max-w-[200px]">
            {state.user?.name ?? "—"}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/60 border border-red-700 rounded-lg text-sm text-red-200">
          {error}
        </div>
      )}

      <main className="flex-1 flex flex-col items-center px-4 pt-4 pb-6 gap-5" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>

        {/* Complete panel — shown right after task is completed */}
        {completedTask && !hasTask && (
          <CompletePanel
            taskId={completedTask.id}
            taskName={completedTask.name}
            projectName={completedTask.projectName}
            elapsedSeconds={completedTask.elapsedSeconds}
            telegramId={telegramId!}
            onDone={() => {
              setCompletedTask(null);
              if (telegramId) fetchState(telegramId);
            }}
          />
        )}

        {/* Active task card */}
        {hasTask && (
          <section className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-400 mb-0.5 truncate">{projectName}</div>
                <div className="text-base font-semibold leading-snug break-words">{task.name}</div>
              </div>
              <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${
                isRunning ? "bg-green-900/60 text-green-400" : "bg-yellow-900/60 text-yellow-400"
              }`}>
                {isRunning ? "🟢 Активна" : "⏸️ Пауза"}
              </span>
            </div>

            <div className="flex flex-col items-center py-2">
              <div className="text-5xl font-mono font-bold tracking-tight tabular-nums">
                {formatHMS(elapsedSeconds)}
              </div>
              <div className="text-xs text-slate-400 mt-1">витрачено часу</div>
            </div>

            <div className="flex gap-3">
              {isRunning && (
                <button onClick={async () => { await doAction("pause"); if (telegramId) await fetchState(telegramId); }} disabled={actionLoading}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded-xl text-sm font-semibold text-slate-900 transition-colors">
                  ⏸️ Пауза
                </button>
              )}
              {isPaused && (
                <button onClick={async () => { await doAction("resume"); if (telegramId) await fetchState(telegramId); }} disabled={actionLoading}
                  className="flex-1 py-3 bg-green-500 hover:bg-green-400 disabled:opacity-50 rounded-xl text-sm font-semibold text-slate-900 transition-colors">
                  ▶️ Відновити
                </button>
              )}
              <button onClick={handleComplete} disabled={actionLoading}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors">
                ✅ Завершити
              </button>
            </div>
          </section>
        )}

        {/* No active task + no complete panel */}
        {!hasTask && !completedTask && (
          <section className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col items-center gap-3">
            <div className="text-4xl">⏱️</div>
            <div className="text-base font-semibold">Немає активної задачі</div>
            <div className="text-sm text-slate-400 text-center">Розпочніть нову задачу, щоб почати відстеження часу</div>
            {!showNewTask && (
              <button onClick={() => setShowNewTask(true)}
                className="mt-1 w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition-colors">
                🚀 Почати задачу
              </button>
            )}
          </section>
        )}

        {/* New task form */}
        {showNewTask && !hasTask && !completedTask && (
          <section className="w-full bg-slate-800 rounded-2xl p-5 flex flex-col gap-4">
            <div className="text-sm font-semibold">📝 Нова задача</div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block" htmlFor="project-select">Проєкт</label>
              <select id="project-select" value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">Оберіть проєкт...</option>
                {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block" htmlFor="task-name">Назва задачі</label>
              <input id="task-name" type="text" value={taskName} onChange={(e) => setTaskName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStart()} placeholder="Що будете робити?" maxLength={200} autoFocus
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShowNewTask(false); setTaskName(""); setSelectedProject(""); }}
                className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-semibold transition-colors">
                Скасувати
              </button>
              <button onClick={handleStart} disabled={!selectedProject || !taskName.trim() || actionLoading}
                className="flex-1 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors">
                🚀 Розпочати
              </button>
            </div>
          </section>
        )}

        {/* Today's summary */}
        {state.todayTasks.length > 0 && !completedTask && (
          <section className="w-full">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-300">📅 Сьогодні</div>
              <div className="text-xs text-slate-400">Всього: {formatTotalTime(todayTotalMin)}</div>
            </div>
            <div className="flex flex-col gap-2">
              {state.todayTasks.map((t, i) => {
                const files = (t.attachments ?? []).filter((a) => a.type === 'file');
                const comments = (t.attachments ?? []).filter((a) => a.type === 'text');
                const parseFile = (content: string) => {
                  const nl = content.indexOf('\n');
                  const name = nl !== -1 ? content.slice(0, nl).trim() : 'Файл';
                  const url = nl !== -1 ? content.slice(nl + 1).trim() : content;
                  const isImg = /\.(jpe?g|png|gif|webp)$/i.test(name);
                  const display = /^photo_\d+\.(jpg|jpeg)$/i.test(name) ? 'Фото' : name;
                  return { name, display, url, isImg };
                };
                return (
                  <div key={i} className="bg-slate-800 rounded-xl px-4 py-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{t.taskName}</div>
                        <div className="text-xs text-slate-400 truncate">{t.projectName}</div>
                      </div>
                      <div className="shrink-0 ml-3 text-right">
                        <div className="text-sm font-mono text-slate-300">{formatTotalTime(t.timeSpent.totalMinutes)}</div>
                        <div className={`text-xs ${t.status === "completed" ? "text-green-400" : t.status === "in_progress" ? "text-blue-400" : "text-yellow-400"}`}>
                          {t.status === "completed" ? "✅ Завершено" : t.status === "in_progress" ? "🟢 Активна" : "⏸️ Пауза"}
                        </div>
                      </div>
                    </div>

                    {/* Comments */}
                    {comments.map((c, ci) => (
                      <div key={ci} className="text-xs text-slate-400 leading-relaxed border-t border-slate-700 pt-2">
                        💬 {c.content.replace(/^💬\s*/, '')}
                      </div>
                    ))}

                    {/* File attachments */}
                    {files.length > 0 && (
                      <div className="border-t border-slate-700 pt-2 flex flex-col gap-1.5">
                        {files.map((f, fi) => {
                          const { display, url, isImg } = parseFile(f.content);
                          return isImg ? (
                            <a key={fi} href={url} target="_blank" rel="noopener noreferrer"
                              className="block rounded-lg overflow-hidden">
                              <img src={url} alt={display} loading="lazy"
                                className="w-full max-h-40 object-cover rounded-lg"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            </a>
                          ) : (
                            <button
                              key={fi}
                              type="button"
                              onClick={() => {
                                const tg = (window as any).Telegram?.WebApp;
                                if (tg?.openLink) {
                                  tg.openLink(url);
                                } else {
                                  window.open(url, '_blank', 'noopener,noreferrer');
                                }
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 bg-slate-700 rounded-lg text-xs text-slate-300 hover:text-white transition-colors text-left">
                              <span>📄</span>
                              <span className="truncate flex-1">{display}</span>
                              <span className="text-slate-500 flex-shrink-0">↗</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
