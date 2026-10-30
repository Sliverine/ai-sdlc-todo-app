import { describe, expect, it } from "vitest";
import { REMINDER_OPTIONS, reminderLabel, reminderMinutesSchema, reminderResponseSchema } from "@/lib/reminders";

describe("reminder contract", () => {
  it("contains precisely the seven supported offsets with labels", () => {
    expect(REMINDER_OPTIONS.map((item) => item.minutes)).toEqual([15, 30, 60, 120, 1440, 2880, 10080]);
    for (const option of REMINDER_OPTIONS) expect(reminderLabel(option.minutes)).toBe(option.short);
  });
  it.each([0, 1, -15, 90, 1441, "15", null])("rejects invalid offset %s", (value) => {
    expect(reminderMinutesSchema.safeParse(value).success).toBe(false);
  });
  it("rejects malformed notification payloads", () => {
    expect(reminderResponseSchema.safeParse({ success: true, data: [{ id: 1 }] }).success).toBe(false);
  });
});
