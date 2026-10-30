import Database from "better-sqlite3";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { createTodo, installNotifications, register } from "./helpers";
import { getSingaporeNow, toSingaporeInput } from "@/lib/timezone";
import type { Todo } from "@/lib/db";

test("seven offsets, due-date gating, edit and persisted reminder settings", async ({ page }) => {
  await register(page);
  await expect(page.getByLabel("Reminder", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Reminder", { exact: true }).locator("option")).toHaveCount(8);
  for (const [minutes, label] of [[15, "15m"], [30, "30m"], [60, "1h"], [120, "2h"], [1440, "1d"], [2880, "2d"], [10080, "1w"]] as const) {
    await createTodo(page, `Reminder ${minutes}`, minutes);
    await expect(page.getByLabel(`Reminder ${label}`, { exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByLabel("Reminder 1w", { exact: true })).toBeVisible();
  const row = page.getByRole("article").filter({ hasText: "Reminder 15" }).first();
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Edit Reminder", { exact: true }).selectOption("60");
  await page.getByRole("button", { name: "Update todo" }).click();
  await expect(row.getByLabel("Reminder 1h")).toBeVisible();
});

test("real authenticated check, display, acknowledgement, rearm and refresh deduplication", async ({ page }) => {
  await installNotifications(page, "default");
  await register(page);
  const todo = await createTodo(page, "Due soon", 15);
  const initial = await page.request.get("/api/notifications/check");
  expect(initial.status()).toBe(200);
  expect(await initial.json()).toMatchObject({ success: true, data: [expect.objectContaining({ id: todo.id })] });
  await page.getByRole("button", { name: "Enable Notifications" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/todos/${todo.id}`);
    return (await response.json() as Todo).last_notification_sent;
  }).not.toBeNull();
  expect(await page.evaluate(() => Reflect.get(window, "__notifications"))).toHaveLength(1);
  const after = await page.request.get("/api/notifications/check");
  expect((await after.json()).data).toEqual([]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Notifications On" })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__notifications"))).toHaveLength(0);

  await page.getByRole("article").getByRole("button", { name: "Edit", exact: true }).click();
  const newDue = getSingaporeNow();
  newDue.setTime(newDue.getTime() + 20 * 60_000);
  await page.getByLabel("Edit Due date (Singapore time)", { exact: true }).fill(toSingaporeInput(newDue.toISOString()));
  await page.getByRole("button", { name: "Update todo" }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/todos/${todo.id}`)).json()).last_notification_sent).toBeNull();
  await page.getByRole("article").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Edit Reminder", { exact: true }).selectOption("30");
  await page.getByRole("button", { name: "Update todo" }).click();
  await page.reload();
  await expect.poll(async () => (await (await page.request.get(`/api/todos/${todo.id}`)).json()).last_notification_sent).not.toBeNull();
});

test("unacknowledged overdue reminders are returned, completed todos are excluded", async ({ page }) => {
  await register(page);
  const todo = await createTodo(page, "Overdue on return", 15);
  const db = new Database(resolve(".e2e-todos.db"));
  try {
    db.prepare("UPDATE todos SET due_date = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", todo.id);
  } finally { db.close(); }
  const response = await page.request.get("/api/notifications/check");
  expect((await response.json()).data).toEqual([expect.objectContaining({ id: todo.id })]);
  const complete = await page.request.put(`/api/todos/${todo.id}`, { data: { completed: true } });
  expect(complete.ok()).toBe(true);
  expect((await (await page.request.get("/api/notifications/check")).json()).data).toEqual([]);
});

test("reminders require a session and cannot cross user boundaries", async ({ page, browser }) => {
  await register(page);
  const todo = await createTodo(page, "Private reminder", 15);
  const other = await browser.newContext({ baseURL: "http://localhost:3100" });
  try {
    expect((await other.request.get("/api/notifications/check")).status()).toBe(401);
    const secondPage = await other.newPage();
    await register(secondPage);
    expect((await (await other.request.get("/api/notifications/check")).json()).data).toEqual([]);
    expect((await other.request.put(`/api/todos/${todo.id}`, {
      data: { last_notification_sent: getSingaporeNow().toISOString() },
    })).status()).toBe(404);
  } finally { await other.close(); }
});

test("passkey login, completion, recurrence inheritance and logout prerequisites", async ({ page }) => {
  const cdp = await register(page);
  const me = await (await page.request.get("/api/auth/me")).json();
  await page.getByLabel("Repeat", { exact: true }).check();
  await page.getByLabel("Recurrence pattern", { exact: true }).selectOption("daily");
  const todo = await createTodo(page, "Daily reminder", 30);
  await page.getByRole("article").getByRole("checkbox").check();
  await expect(page.getByRole("article")).toHaveCount(2);
  const all: Todo[] = await (await page.request.get("/api/todos")).json();
  const next = all.find((item) => item.id !== todo.id);
  expect(next).toMatchObject({ completed: false, reminder_minutes: 30, last_notification_sent: null, is_recurring: true });
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL("/login");
  await page.getByLabel("Username").fill(me.username ?? me.user?.username);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("article")).toHaveCount(2);
  await cdp.detach();
});
