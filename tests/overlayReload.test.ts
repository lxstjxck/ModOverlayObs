import { afterEach, expect, it, vi } from "vitest";
import type { Socket } from "socket.io";
import { OverlayReloadManager } from "../src/server/overlayReload";

afterEach(() => vi.restoreAllMocks());

it("times out without mistaking receipt for a successful reload", () => {
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  const manager = new OverlayReloadManager();
  let acknowledge: (() => void) | undefined;
  const socket = { id: "old", connected: true, emit: vi.fn((_event, _payload, callback) => { acknowledge = callback; }) } as unknown as Socket;
  const started = manager.start("channel-a", [socket]);
  expect(started.code).toBe(200);
  acknowledge?.();
  expect(manager.get("channel-a", started.status!.id)).toMatchObject({ state: "waiting", received: 1, reconnected: 0 });
  vi.spyOn(Date, "now").mockReturnValue(now + 15_001);
  manager.ready("channel-a", "replacement", (socket.emit as ReturnType<typeof vi.fn>).mock.calls[0][1].attemptId);
  expect(manager.get("channel-a", started.status!.id)).toMatchObject({ state: "timed_out", received: 1, reconnected: 0 });
  expect(manager.start("channel-a", [socket]).code).toBe(409);
  vi.spyOn(Date, "now").mockReturnValue(now + 25_001);
  expect(manager.start("channel-a", [socket]).code).toBe(200);
});
