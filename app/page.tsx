"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import type { Priority, RecurrencePattern, ReminderMinutes, Todo } from "@/lib/db";
import { requestJson, responseError } from "@/lib/client-api";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { REMINDER_OPTIONS, reminderLabel, reminderMinutesSchema } from "@/lib/reminders";
import { formatSingaporeDate, getSingaporeNow, parseSingaporeDate, toSingaporeInput } from "@/lib/timezone";

type Draft = {
  title: string;
  due_date: string;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern;
  reminder_minutes: ReminderMinutes | null;
};
const emptyDraft: Draft = {
  title: "", due_date: "", priority: "medium", is_recurring: false,
  recurrence_pattern: "daily", reminder_minutes: null,
};
const priorities: Priority[] = ["high", "medium", "low"];
const patterns: RecurrencePattern[] = ["daily", "weekly", "monthly", "yearly"];

function TodoFields({ draft, setDraft, prefix = "" }: {
  draft: Draft; setDraft: (value: Draft) => void; prefix?: string;
}) {
  return <div className="fields">
    <label>{prefix}Title
      <input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
    </label>
    <label>{prefix}Due date (Singapore time)
      <input type="datetime-local" value={draft.due_date} onChange={(event) => {
        const due_date = event.target.value;
        setDraft({ ...draft, due_date, reminder_minutes: due_date ? draft.reminder_minutes : null });
      }} />
    </label>
    <label>{prefix}Priority
      <select value={draft.priority} onChange={(event) => {
        const priority = priorities.find((value) => value === event.target.value);
        if (priority) setDraft({ ...draft, priority });
      }}>
        {priorities.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
    <label>{prefix}Reminder
      <select value={draft.reminder_minutes ?? ""} disabled={!draft.due_date} onChange={(event) =>
        setDraft({ ...draft, reminder_minutes: event.target.value === "" ? null : reminderMinutesSchema.parse(Number(event.target.value)) })}>
        <option value="">None</option>
        {REMINDER_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
      </select>
    </label>
    <label>{prefix}Repeat
      <input type="checkbox" checked={draft.is_recurring} onChange={(event) =>
        setDraft({ ...draft, is_recurring: event.target.checked })} />
    </label>
    {draft.is_recurring && <label>{prefix}Recurrence pattern
      <select value={draft.recurrence_pattern} onChange={(event) => {
        const recurrence_pattern = patterns.find((value) => value === event.target.value);
        if (recurrence_pattern) setDraft({ ...draft, recurrence_pattern });
      }}>
        {patterns.map((value) => <option key={value}>{value}</option>)}
      </select>
    </label>}
  </div>;
}

function draftPayload(draft: Draft) {
  if (!draft.title.trim()) throw new Error("Title is required.");
  if (draft.is_recurring && !draft.due_date) throw new Error("Recurring todos require a due date.");
  return {
    ...draft, title: draft.title.trim(),
    due_date: draft.due_date ? parseSingaporeDate(draft.due_date).toISOString() : null,
    recurrence_pattern: draft.is_recurring ? draft.recurrence_pattern : null,
  };
}

function sorted(todos: Todo[]) {
  return [...todos].sort((a, b) =>
    priorities.indexOf(a.priority) - priorities.indexOf(b.priority) ||
    (a.due_date ? parseSingaporeDate(a.due_date).getTime() : Infinity) -
      (b.due_date ? parseSingaporeDate(b.due_date).getTime() : Infinity) ||
    parseSingaporeDate(b.created_at).getTime() - parseSingaporeDate(a.created_at).getTime());
}

export default function TodoPage() {
  const router = useRouter();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [now, setNow] = useState(() => getSingaporeNow().getTime());
  const dialog = useRef<HTMLDialogElement>(null);
  const notifications = useNotifications(!loading && !signedOut);

  const loadTodos = useCallback(async () => {
    const response = await fetch("/api/todos", { cache: "no-store" });
    if (response.status === 401) {
      setSignedOut(true);
      router.replace("/login");
      return;
    }
    if (!response.ok) throw new Error(await responseError(response));
    setTodos(await response.json());
  }, [router]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(loadTodos).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : "Could not load todos.");
    }).finally(() => { if (active) setLoading(false); });
    const timer = setInterval(() => setNow(getSingaporeNow().getTime()), 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [loadTodos]);

  useEffect(() => { if (editing) dialog.current?.showModal(); }, [editing]);

  async function createTodo(event: FormEvent) {
    event.preventDefault();
    setError(null);
    let temporaryId: number | null = null;
    try {
      const payload = draftPayload(draft);
      setBusy(true);
      temporaryId = -getSingaporeNow().getTime();
      const optimistic: Todo = {
        ...payload, id: temporaryId, user_id: 0, completed: false,
        created_at: getSingaporeNow().toISOString(), updated_at: null, last_notification_sent: null,
      };
      setTodos((current) => [...current, optimistic]);
      const created = await requestJson<Todo>("/api/todos", { method: "POST", body: JSON.stringify(payload) });
      setTodos((current) => current.map((todo) => todo.id === temporaryId ? created : todo));
      setDraft(emptyDraft);
    } catch (failure) {
      if (temporaryId !== null) setTodos((current) => current.filter((todo) => todo.id !== temporaryId));
      setError(failure instanceof Error ? failure.message : "Could not create todo.");
    } finally { setBusy(false); }
  }

  async function updateTodo(todo: Todo, change: Partial<Todo>, remove = false) {
    setError(null);
    setPending((current) => new Set([...current, todo.id]));
    setTodos((current) => remove ? current.filter((item) => item.id !== todo.id)
      : current.map((item) => item.id === todo.id ? { ...item, ...change } : item));
    try {
      const response = await requestJson<Todo>(`/api/todos/${todo.id}`, {
        method: remove ? "DELETE" : "PUT", ...(!remove && { body: JSON.stringify(change) }),
      });
      if (!remove) setTodos((current) => current.map((item) => item.id === todo.id ? response : item));
      if (change.completed && todo.is_recurring) await loadTodos();
      return true;
    } catch (failure) {
      setTodos((current) => remove ? [...current, todo] : current.map((item) => item.id === todo.id ? todo : item));
      setError(failure instanceof Error ? failure.message : "Could not update todo.");
      return false;
    } finally { setPending((current) => new Set([...current].filter((id) => id !== todo.id))); }
  }

  function openEdit(todo: Todo) {
    setEditDraft({
      title: todo.title, due_date: toSingaporeInput(todo.due_date), priority: todo.priority,
      is_recurring: todo.is_recurring, recurrence_pattern: todo.recurrence_pattern ?? "daily",
      reminder_minutes: todo.reminder_minutes,
    });
    setEditing(todo);
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    try {
      const payload = draftPayload(editDraft);
      const initialInput = toSingaporeInput(editing.due_date);
      const change = { ...payload, due_date: editDraft.due_date === initialInput ? editing.due_date : payload.due_date };
      if (await updateTodo(editing, change)) setEditing(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save todo."); }
  }

  async function logout() {
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
      setSignedOut(true);
      router.replace("/login");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not log out."); }
  }

  const visible = sorted(todos.filter((todo) => priorityFilter === "all" || todo.priority === priorityFilter));
  const groups = [
    { title: "Overdue", rows: visible.filter((todo) => !todo.completed && todo.due_date && parseSingaporeDate(todo.due_date).getTime() < now) },
    { title: "Pending", rows: visible.filter((todo) => !todo.completed && (!todo.due_date || parseSingaporeDate(todo.due_date).getTime() >= now)) },
    { title: "Completed", rows: visible.filter((todo) => todo.completed) },
  ];

  return <main>
    <header>
      <h1>Singapore Todo</h1>
      <div className="toolbar">
        <button className={notifications.permission === "granted" ? "enabled" : ""}
          disabled={!notifications.supported || notifications.permission !== "default"}
          onClick={() => void notifications.requestPermission()}>
          {notifications.permission === "granted" ? "Notifications On" : notifications.permission === "denied" ? "Notifications blocked" : "Enable Notifications"}
        </button>
        <Link href="/login">Passkey settings</Link>
        <button className="secondary" onClick={() => void logout()}>Logout</button>
      </div>
    </header>
    <p className="muted">All dates use Singapore time. Keep this app open for browser reminders; overdue reminders are delivered when you return.</p>
    {!notifications.supported && !loading && <p>Desktop notifications are unavailable in this browser.</p>}
    {notifications.permission === "denied" && <p>Allow notifications in your browser site settings, then reload this page.</p>}
    {(error || notifications.error) && <div role="alert" className="error">{error || notifications.error}</div>}
    <form onSubmit={(event) => void createTodo(event)} aria-label="Create todo">
      <TodoFields draft={draft} setDraft={setDraft} />
      <button disabled={loading || busy || !draft.title.trim()} type="submit">{busy ? "Adding..." : "Add todo"}</button>
    </form>
    <label>Filter by priority
      <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
        <option value="all">All priorities</option>
        {priorities.map((value) => <option key={value}>{value}</option>)}
      </select>
    </label>
    {loading && <p role="status">Loading todos...</p>}
    {!loading && !error && todos.length === 0 && <p>You have no todos yet.</p>}
    {groups.filter((group) => group.rows.length).map((group) => <section key={group.title} aria-label={group.title}>
      <h2>{group.title} ({group.rows.length})</h2>
      {group.rows.map((todo) => <article key={todo.id} data-testid={`todo-${todo.id}`}>
        <div className="todo-heading">
          <label className={`todo-title ${todo.completed ? "completed" : ""}`}>
            <input type="checkbox" checked={todo.completed} disabled={pending.has(todo.id) || todo.id < 0}
              onChange={() => void updateTodo(todo, { completed: !todo.completed })} />
            {todo.title}
          </label>
          <div className="toolbar">
            <button className="secondary" disabled={pending.has(todo.id) || todo.id < 0} onClick={() => openEdit(todo)}>Edit</button>
            <button className="danger" disabled={pending.has(todo.id) || todo.id < 0} onClick={() => void updateTodo(todo, {}, true)}>Delete</button>
          </div>
        </div>
        <div className="badges">
          <span className={`badge ${todo.priority}`}>{todo.priority}</span>
          {todo.reminder_minutes !== null && <span className="badge" aria-label={`Reminder ${reminderLabel(todo.reminder_minutes)}`}>
            &#128276; {reminderLabel(todo.reminder_minutes)}
          </span>}
          {todo.is_recurring && <span className="badge">&#128260; {todo.recurrence_pattern}</span>}
        </div>
        {todo.due_date && <p className="muted">Due {formatSingaporeDate(todo.due_date)}</p>}
      </article>)}
    </section>)}
    {editing && <dialog ref={dialog} onCancel={() => setEditing(null)}
      onClick={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
      <form aria-label="Edit todo" onSubmit={(event) => void saveEdit(event)}>
        <h2>Edit todo</h2>
        <TodoFields draft={editDraft} setDraft={setEditDraft} prefix="Edit " />
        {error && <p role="alert">{error}</p>}
        <div className="toolbar">
          <button type="submit" disabled={pending.has(editing.id)}>Update todo</button>
          <button className="secondary" type="button" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </form>
    </dialog>}
  </main>;
}
