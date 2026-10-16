import { expect, it } from "vitest";
import {
  shouldClearOverlayOnConnectError,
  shouldClearOverlayOnDisconnect
} from "../src/client/overlayConnection";

it("keeps the last scene during recoverable transport failures", () => {
  for (const reason of ["transport close", "ping timeout", "transport error", "io client disconnect"]) {
    expect(shouldClearOverlayOnDisconnect(reason)).toBe(false);
  }
  expect(shouldClearOverlayOnConnectError("websocket error")).toBe(false);
  expect(shouldClearOverlayOnConnectError("Too many socket connections. Try again later.")).toBe(false);
});

it("clears the scene when the server revokes the connection or rejects OBS credentials", () => {
  expect(shouldClearOverlayOnDisconnect("io server disconnect")).toBe(true);
  expect(shouldClearOverlayOnConnectError("Invalid overlay token")).toBe(true);
  expect(shouldClearOverlayOnConnectError("Twitch authentication required")).toBe(true);
});
