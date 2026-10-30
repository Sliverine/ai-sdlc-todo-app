// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotifications } from "@/lib/hooks/useNotifications";

const due = {
  id: 7,
  title: "Team meeting",
  due_date: "2026-10-30T09:00:00.000Z",
  reminder_minutes: 15,
};

let permission: NotificationPermission;
const show = vi.fn();
const requestPermission = vi.fn();
const fetchMock = vi.fn();
const check = () => Response.json({ success: true, data: [due] });

async function settle() {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  permission = "granted";
  class NotificationMock {
    static get permission() { return permission; }
    static requestPermission = requestPermission;
    constructor(title: string, options: NotificationOptions) { show(title, options); }
  }
  vi.stubGlobal("Notification", NotificationMock);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === "PUT" ? Response.json({}) : check());
  requestPermission.mockImplementation(async () => { permission = "granted"; return permission; });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("notification polling", () => {
  it("uses an existing grant, polls immediately, shows Singapore time and acknowledges after display", async () => {
    renderHook(() => useNotifications());
    await settle();
    expect(show).toHaveBeenCalledWith("Team meeting", expect.objectContaining({
      tag: "todo-7",
      body: expect.stringContaining("17:00"),
    }));
    expect(fetchMock).toHaveBeenCalledWith("/api/todos/7", expect.objectContaining({ method: "PUT" }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      notification_due_date: due.due_date,
      notification_reminder_minutes: 15,
    });
  });

  it("polls every thirty seconds and does not redisplay an already displayed schedule", async () => {
    renderHook(() => useNotifications());
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/notifications/check")).toHaveLength(3);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("waits for an explicit permission request", async () => {
    permission = "default";
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { await result.current.requestPermission(); });
    await settle();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("surfaces denied permission without polling", async () => {
    permission = "denied";
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(result.current.permission).toBe("denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles unsupported browsers explicitly", async () => {
    vi.stubGlobal("Notification", undefined);
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(result.current.supported).toBe(false);
    await act(async () => { await result.current.requestPermission(); });
    expect(result.current.error).toMatch(/not support/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports polling failure and retries on the next interval", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }));
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(result.current.error).toMatch(/Unavailable/);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(show).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it("retries failed acknowledgement without displaying the notification again", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? Response.json({ error: "Try again" }, { status: 503 }) : check());
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(result.current.error).toMatch(/Try again/);
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? Response.json({}) : check());
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(show).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(2);
  });

  it("shows a reminder again when its schedule changes", async () => {
    renderHook(() => useNotifications());
    await settle();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? Response.json({}) : Response.json({
        success: true, data: [{ ...due, due_date: "2026-10-31T09:00:00.000Z" }],
      }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(show).toHaveBeenCalledTimes(2);
  });

  it("does not acknowledge when display fails", async () => {
    show.mockImplementationOnce(() => { throw new Error("Display failed"); });
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(result.current.error).toMatch(/Display failed/);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(show).toHaveBeenCalledTimes(2);
  });

  it("stops displaying when permission is revoked", async () => {
    renderHook(() => useNotifications());
    await settle();
    permission = "denied";
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("cleans up polling on unmount", async () => {
    const { unmount } = renderHook(() => useNotifications());
    await settle();
    unmount();
    const calls = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("does not poll when disabled (including logout)", async () => {
    renderHook(() => useNotifications(false));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces permission request errors", async () => {
    permission = "default";
    requestPermission.mockRejectedValueOnce(new Error("Permission failed"));
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await result.current.requestPermission(); });
    expect(result.current.error).toMatch(/Permission failed/);
  });

  it("does not dispatch results from an in-flight check after unmount", async () => {
    let resolve: (value: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    const { unmount } = renderHook(() => useNotifications());
    unmount();
    await act(async () => { resolve(check()); });
    expect(show).not.toHaveBeenCalled();
  });

  it("does not overlap slow polling requests", async () => {
    let resolve: (value: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    renderHook(() => useNotifications());
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(check()); });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("reports invalid response shapes instead of dispatching them", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ success: true, data: [{ ...due, reminder_minutes: 90 }] }));
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(result.current.error).toMatch(/Invalid reminder response/);
    expect(show).not.toHaveBeenCalled();
  });

  it("stops polling an expired session", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Not authenticated" }, { status: 401 }));
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(result.current.error).toMatch(/Not authenticated/);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not treat a changed schedule acknowledgement as a generic failure", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? Response.json({ error: "Schedule changed" }, { status: 409 }) : check());
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(result.current.error).toBeNull();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("surfaces non-JSON HTTP errors with their status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Service unavailable", { status: 503 }));
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(result.current.error).toMatch(/503/);
  });
});
