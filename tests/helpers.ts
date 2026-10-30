import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import type { Todo } from "@/lib/db";
import { getSingaporeNow, toSingaporeInput } from "@/lib/timezone";

export async function register(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(`e2e-${randomUUID()}`);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Today, in focus." })).toBeVisible();
  return cdp;
}

export async function createTodo(page: Page, title: string, reminder?: number): Promise<Todo> {
  const due = getSingaporeNow();
  due.setTime(due.getTime() + 10 * 60_000);
  await page.getByLabel("Task", { exact: true }).fill(title);
  await page.getByLabel("Due date and time (Singapore)", { exact: true }).fill(toSingaporeInput(due.toISOString()));
  if (reminder) await page.getByLabel("Reminder", { exact: true }).selectOption(String(reminder));
  const created = page.waitForResponse((response) =>
    response.url().endsWith("/api/todos") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Add todo", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  return response.json();
}

export async function addSubtask(page: Page, todoTitle: string, title: string) {
  const row = page.locator(".todo-row").filter({ has: page.locator(".todo-title", { hasText: todoTitle }) });
  const toggle = row.getByRole("button", { name: "Show subtasks" });
  if (await toggle.isVisible()) await toggle.click();
  await row.getByRole("textbox", { name: `Subtask title for ${todoTitle}` }).fill(title);
  const created = page.waitForResponse((response) =>
    response.url().endsWith("/subtasks") && response.request().method() === "POST");
  await row.getByRole("button", { name: "Add subtask", exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(row.getByText(title, { exact: true })).toBeVisible();
}

export async function createTag(page: Page, name: string) {
  await page.getByRole("button", { name: "Manage tags", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Tag name").fill(name);
  const created = page.waitForResponse((response) =>
    response.url().endsWith("/api/tags") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Create tag", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  await expect(dialog.getByText(name, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close tags dialog" }).click();
  return response.json();
}

export async function installNotifications(page: Page, permission: NotificationPermission = "granted") {
  await page.addInitScript((initialPermission) => {
    Object.defineProperty(window, "__notifications", { value: [], writable: true });
    class TestNotification {
      static permission: NotificationPermission = initialPermission;
      static async requestPermission() {
        TestNotification.permission = "granted";
        return "granted" as const;
      }
      constructor(title: string, options: NotificationOptions) {
        const events: unknown = Reflect.get(window, "__notifications");
        if (Array.isArray(events)) events.push({ title, options });
      }
    }
    Object.defineProperty(window, "Notification", { value: TestNotification, configurable: true });
  }, permission);
}
