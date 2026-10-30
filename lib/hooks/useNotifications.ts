"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { responseError } from "@/lib/client-api";
import { reminderKey, reminderResponseSchema } from "@/lib/reminders";
import { formatSingaporeDate, getSingaporeNow } from "@/lib/timezone";

const POLL_INTERVAL = 30_000;

export function useNotifications(enabled = true) {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const displayed = new Set<string>();
    const acknowledged = new Set<string>();
    let running = false;
    let expired = false;
    let active = true;

    async function poll() {
      if (!active || running || expired) return;
      const available = typeof Notification !== "undefined";
      setSupported(available);
      if (!available) return;
      setPermission(Notification.permission);
      if (Notification.permission !== "granted") return;
      running = true;
      try {
        const response = await fetch("/api/notifications/check", {
          cache: "no-store", signal: controller.signal,
        });
        if (response.status === 401) expired = true;
        if (!response.ok) throw new Error(await responseError(response));
        const payload = reminderResponseSchema.safeParse(await response.json());
        if (!payload.success) throw new Error("Invalid reminder response. Please refresh and try again.");
        if (!active) return;
        const keys = new Set(payload.data.data.map(reminderKey));
        for (const key of displayed) if (!keys.has(key)) displayed.delete(key);
        for (const key of acknowledged) if (!keys.has(key)) acknowledged.delete(key);
        for (const todo of payload.data.data) {
          if (!active || Notification.permission !== "granted") break;
          const key = reminderKey(todo);
          if (acknowledged.has(key)) continue;
          if (!displayed.has(key)) {
            new Notification(todo.title, {
              body: `Due ${formatSingaporeDate(todo.due_date)}`,
              tag: `todo-${todo.id}`,
            });
            displayed.add(key);
          }
          const acknowledgement = await fetch(`/api/todos/${todo.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              last_notification_sent: getSingaporeNow().toISOString(),
              notification_due_date: todo.due_date,
              notification_reminder_minutes: todo.reminder_minutes,
            }),
          });
          if (acknowledgement.status === 401) expired = true;
          if (acknowledgement.status === 409 || acknowledgement.status === 404) continue;
          if (!acknowledgement.ok) throw new Error(await responseError(acknowledgement));
          acknowledged.add(key);
        }
        if (active) setError(null);
      } catch (failure) {
        if (active && !controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Could not check reminders.");
        }
      } finally {
        running = false;
      }
    }

    pollRef.current = poll;
    void Promise.resolve().then(poll);
    const interval = setInterval(() => { void poll(); }, POLL_INTERVAL);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
      pollRef.current = null;
    };
  }, [enabled]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") {
      setError("This browser does not support desktop notifications.");
      return;
    }
    try {
      setPermission(await Notification.requestPermission());
      setError(null);
      await pollRef.current?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not request notification permission.");
    }
  }, []);

  return { permission, supported, error, requestPermission };
}
