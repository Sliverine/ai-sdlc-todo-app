import { z } from "zod";
import type { ReminderMinutes } from "@/lib/db";

export const REMINDER_OPTIONS = [
  { minutes: 15, label: "15 minutes before", short: "15m" },
  { minutes: 30, label: "30 minutes before", short: "30m" },
  { minutes: 60, label: "1 hour before", short: "1h" },
  { minutes: 120, label: "2 hours before", short: "2h" },
  { minutes: 1440, label: "1 day before", short: "1d" },
  { minutes: 2880, label: "2 days before", short: "2d" },
  { minutes: 10080, label: "1 week before", short: "1w" },
] as const satisfies readonly { minutes: ReminderMinutes; label: string; short: string }[];

export const reminderMinutesSchema = z.union([
  z.literal(15), z.literal(30), z.literal(60), z.literal(120),
  z.literal(1440), z.literal(2880), z.literal(10080),
]);

export const reminderResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(z.object({
    id: z.number().int().positive(),
    title: z.string(),
    due_date: z.iso.datetime({ offset: true }),
    reminder_minutes: reminderMinutesSchema,
  })),
});

export type DueReminder = z.infer<typeof reminderResponseSchema>["data"][number];

export function reminderLabel(minutes: ReminderMinutes): string {
  const option = REMINDER_OPTIONS.find((item) => item.minutes === minutes);
  if (!option) throw new Error("Invalid reminder offset");
  return option.short;
}

export function reminderKey(todo: DueReminder): string {
  return `${todo.id}:${todo.due_date}:${todo.reminder_minutes}`;
}
