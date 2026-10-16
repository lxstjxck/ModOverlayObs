import type { MediaStatus, MediaStatusInput } from "../shared/mediaStatus";

// Telemetry belongs to a socket, never to the persisted scene.
export class MediaStatuses {
  private readonly channels = new Map<string, Map<string, Map<string, MediaStatus>>>();
  private readonly lastReceived = new Map<string, Map<string, number>>();

  update(channelId: string, socketId: string, input: MediaStatusInput, now = Date.now()): MediaStatus | null {
    if (input.connectionId !== socketId) return null;
    const bySocket = this.channels.get(channelId) ?? new Map<string, Map<string, MediaStatus>>();
    const statuses = bySocket.get(socketId) ?? new Map<string, MediaStatus>();
    const times = this.lastReceived.get(socketId) ?? new Map<string, number>();
    const previous = statuses.get(input.elementId);
    if (now - (times.get(input.elementId) ?? -Infinity) < 500 &&
        previous?.commandId === input.commandId && previous?.playing === input.playing &&
        Math.abs(previous.position - input.position) < 1) return null;
    if (!statuses.has(input.elementId) && statuses.size >= 100) return null;
    const status = { ...input, observedAt: now };
    statuses.set(input.elementId, status);
    times.set(input.elementId, now);
    bySocket.set(socketId, statuses);
    this.channels.set(channelId, bySocket);
    this.lastReceived.set(socketId, times);
    return status;
  }

  snapshot(channelId: string): MediaStatus[] {
    return [...(this.channels.get(channelId)?.values() ?? [])].flatMap((items) => [...items.values()]);
  }

  removeSocket(channelId: string, socketId: string): void {
    const channel = this.channels.get(channelId);
    channel?.delete(socketId);
    if (channel?.size === 0) this.channels.delete(channelId);
    this.lastReceived.delete(socketId);
  }

  retainElements(channelId: string, ids: ReadonlySet<string>): void {
    for (const [socketId, items] of this.channels.get(channelId) ?? []) {
      for (const id of items.keys()) if (!ids.has(id)) items.delete(id);
      const times = this.lastReceived.get(socketId);
      for (const id of times?.keys() ?? []) if (!ids.has(id)) times?.delete(id);
    }
  }
}
