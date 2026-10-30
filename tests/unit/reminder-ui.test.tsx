// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TodoPage from "@/app/page";

vi.mock("@/lib/hooks/useNotifications", () => ({
  useNotifications: () => ({ permission: "default", supported: true, error: null, requestPermission: vi.fn() }),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("reminder controls", () => {
  it("offers exactly seven reminder options and None, disabled without a due date", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    render(<TodoPage />);
    const select = screen.getByLabelText("Reminder");
    expect(select).toBeDisabled();
    expect(select.querySelectorAll("option")).toHaveLength(8);
    fireEvent.change(screen.getByLabelText("Due date (Singapore time)"), { target: { value: "2030-10-30T17:00" } });
    expect(select).toBeEnabled();
    fireEvent.change(select, { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Due date (Singapore time)"), { target: { value: "" } });
    expect(select).toHaveValue("");
    await waitFor(() => expect(screen.queryByText("Loading todos...")).not.toBeInTheDocument());
  });

  it.each([
    [15, "15m"], [30, "30m"], [60, "1h"], [120, "2h"],
    [1440, "1d"], [2880, "2d"], [10080, "1w"],
  ])("renders the %i reminder badge as %s", async (minutes, label) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([{
      id: 1, title: "Test todo", user_id: 1, completed: false,
      priority: "medium", due_date: "2030-10-30T09:00:00Z",
      is_recurring: false, recurrence_pattern: null, reminder_minutes: minutes,
      last_notification_sent: null, created_at: "2030-01-01T00:00:00Z", updated_at: null,
    }])));
    render(<TodoPage />);
    expect(await screen.findByLabelText(`Reminder ${label}`)).toBeInTheDocument();
  });

  it("surfaces API errors instead of showing an empty success state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      Promise.resolve(Response.json({ error: "Database unavailable" }, { status: 503 }))));
    render(<TodoPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
  });
});
