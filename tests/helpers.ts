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
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Singapore Todo" })).toBeVisible();
  return cdp;
}

export async function createTodo(page: Page, title: string, reminder?: number): Promise<Todo> {
  const due = getSingaporeNow();
  due.setTime(due.getTime() + 10 * 60_000);
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Due date (Singapore time)", { exact: true }).fill(toSingaporeInput(due.toISOString()));
  if (reminder) await page.getByLabel("Reminder", { exact: true }).selectOption(String(reminder));
  const created = page.waitForResponse((response) =>
    response.url().endsWith("/api/todos") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Add todo", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
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
