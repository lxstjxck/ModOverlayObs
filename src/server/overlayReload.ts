import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io";
import type { OverlayReloadStatus } from "../shared/types";

const timeoutMs = 15_000;
const cooldownMs = 10_000;
const retentionMs = 2 * 60_000;

type Target = { socketId: string; attemptId: string; status: "sent" | "received" | "reconnected" };
type Operation = { id: string; channelId: string; startedAt: number; finishedAt?: number; targets: Target[]; timer: NodeJS.Timeout };

export class OverlayReloadManager {
  private readonly operations = new Map<string, Operation>();
  private readonly latestByChannel = new Map<string, string>();

  start(channelId: string, sockets: Socket[]): { code: 200 | 409 | 503; status?: OverlayReloadStatus } {
    const now = Date.now();
    this.prune(now);
    const latestId = this.latestByChannel.get(channelId);
    const latest = latestId && this.operations.get(latestId);
    if (latest && (this.snapshot(latest).state === "waiting" ||
      now - (latest.finishedAt ?? latest.startedAt + timeoutMs) < cooldownMs)) {
      return { code: 409, status: this.snapshot(latest) };
    }
    const connected = sockets.filter((socket) => socket.connected);
    if (!connected.length) return { code: 503 };
    const operation: Operation = {
      id: randomUUID(), channelId, startedAt: now,
      targets: connected.map((socket) => ({ socketId: socket.id, attemptId: randomUUID(), status: "sent" })),
      timer: setTimeout(() => this.prune(Date.now()), retentionMs)
    };
    operation.timer.unref();
    this.operations.set(operation.id, operation);
    this.latestByChannel.set(channelId, operation.id);
    for (const [index, socket] of connected.entries()) {
      const target = operation.targets[index];
      socket.emit("overlay:reload", { attemptId: target.attemptId }, () => {
        if (target.status === "sent") target.status = "received";
      });
    }
    return { code: 200, status: this.snapshot(operation) };
  }

  ready(channelId: string, socketId: string, attemptId: unknown): void {
    if (typeof attemptId !== "string") return;
    const operationId = this.latestByChannel.get(channelId);
    const operation = operationId && this.operations.get(operationId);
    if (!operation || Date.now() - operation.startedAt >= timeoutMs) return;
    const target = operation.targets.find((item) => item.attemptId === attemptId);
    if (!target || target.socketId === socketId || target.status !== "received") return;
    target.status = "reconnected";
    if (operation.targets.every((item) => item.status === "reconnected")) {
      operation.finishedAt = Date.now();
    }
  }

  get(channelId: string, operationId: string): OverlayReloadStatus | null {
    this.prune(Date.now());
    const operation = this.operations.get(operationId);
    return operation?.channelId === channelId ? this.snapshot(operation) : null;
  }

  private snapshot(operation: Operation): OverlayReloadStatus {
    const received = operation.targets.filter((item) => item.status !== "sent").length;
    const reconnected = operation.targets.filter((item) => item.status === "reconnected").length;
    return {
      id: operation.id,
      state: reconnected === operation.targets.length ? "completed" :
        Date.now() - operation.startedAt >= timeoutMs ? "timed_out" : "waiting",
      total: operation.targets.length, received, reconnected
    };
  }

  private prune(now: number): void {
    for (const [id, operation] of this.operations) {
      if (now - operation.startedAt < retentionMs) continue;
      clearTimeout(operation.timer);
      this.operations.delete(id);
      if (this.latestByChannel.get(operation.channelId) === id) this.latestByChannel.delete(operation.channelId);
    }
  }
}

export const overlayReload = new OverlayReloadManager();
