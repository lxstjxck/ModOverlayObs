import type { MediaStatusInput } from "../shared/mediaStatus";
import type { MediaStatus } from "../shared/mediaStatus";
import { previewSyncActions, previewTargetPosition } from "./previewPlaybackSync";

type PlayerState = NonNullable<MediaStatusInput["state"]>;
type Command = "play" | "pause" | "stop" | "restart" | "seek";

interface Player {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  setLoop(loop: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YouTubeApi {
  Player: new (frame: HTMLIFrameElement, options: {
    events: {
      onReady: () => void;
      onStateChange: (event: { data: number }) => void;
      onError: (event: { data: number }) => void;
      onAutoplayBlocked: () => void;
    };
  }) => Player;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const controllers = new WeakMap<HTMLIFrameElement, YouTubePlayerController>();
let apiPromise: Promise<YouTubeApi> | null = null;

function loadApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => {
      window.onYouTubeIframeAPIReady = previous;
      document.querySelector('script[data-youtube-player-api]')?.remove();
      apiPromise = null;
      reject(new Error("YouTube API timeout"));
    }, 12_000);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      window.onYouTubeIframeAPIReady = previous;
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else {
        apiPromise = null;
        reject(new Error("YouTube API unavailable"));
      }
    };
    if (!document.querySelector('script[data-youtube-player-api]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.youtubePlayerApi = "";
      script.onerror = () => {
        window.clearTimeout(timeout);
        window.onYouTubeIframeAPIReady = previous;
        script.remove();
        apiPromise = null;
        reject(new Error("YouTube API unavailable"));
      };
      document.head.append(script);
    }
  });
  return apiPromise;
}

function stateFromCode(code: number): PlayerState {
  return ({ [-1]: "UNSTARTED", 0: "ENDED", 1: "PLAYING", 2: "PAUSED", 3: "BUFFERING", 5: "UNSTARTED" } as Record<number, PlayerState>)[code] ?? "UNKNOWN";
}

function bounded(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(86400, value)) : 0;
}

export class YouTubePlayerController {
  private player: Player | null = null;
  private timer: number | null = null;
  private ready = false;
  private disposed = false;
  private state: PlayerState = "UNKNOWN";
  private errorCode: number | null = null;
  private issue: MediaStatusInput["issue"] = null;
  private commandId: string | null = null;
  private pending: { command: Command; id: string | null; seconds?: number; at: number } | null = null;
  private volume = 1;
  private muted = false;
  private loop = false;
  private durationSample: { value: number; at: number } | null = null;
  private durationConfirmed = false;
  private liveDuration = false;
  private previewSource: string | null = null;
  private previewInitialized = false;
  private previewActionAt = 0;
  private previewAutoMuted = false;
  private previewAudioTouched = false;
  private previewRequestedState: "PLAYING" | "PAUSED" | null = null;

  private readonly listeners = new Set<() => void>();

  constructor(private readonly frame: HTMLIFrameElement, onChange: () => void) {
    this.listeners.add(onChange);
    controllers.set(frame, this);
    void loadApi().then((api) => {
      if (this.disposed) return;
      this.player = new api.Player(frame, { events: {
        onReady: () => {
          if (this.disposed) return;
          this.ready = true;
          try {
            this.player?.setLoop(this.loop);
            this.player?.setVolume(Math.round(this.volume * 100));
            if (this.muted || this.previewAutoMuted) this.player?.mute();
          } catch {
            this.fail();
            return;
          }
          this.flush();
          this.notify();
        },
        onStateChange: ({ data }) => {
          if (this.disposed) return;
          this.state = stateFromCode(data);
          this.errorCode = null;
          this.issue = null;
          this.confirm();
          this.notify();
        },
        onError: ({ data }) => {
          if (this.disposed) return;
          this.state = "ERROR";
          this.errorCode = [2, 5, 100, 101, 150, 153].includes(data) ? data : null;
          this.issue = null;
          this.pending = null;
          this.notify();
        },
        onAutoplayBlocked: () => {
          if (this.disposed) return;
          this.state = "ERROR";
          this.issue = "AUTOPLAY_BLOCKED";
          this.pending = null;
          this.notify();
        }
      } });
      this.timer = window.setInterval(() => {
        if (this.disposed) return;
        this.confirm();
        this.notify();
      }, 1000);
    }).catch(() => {
      if (this.disposed) return;
      this.state = "ERROR";
      this.issue = "API_UNAVAILABLE";
      this.notify();
    });
  }

  configure(volume: number, muted: boolean, loop: boolean): void {
    try {
      if (this.ready && this.volume !== volume) this.player?.setVolume(Math.round(volume * 100));
      if (this.ready && this.muted !== muted) {
        if (muted) this.player?.mute();
        else if (!this.previewAutoMuted) this.player?.unMute();
      }
      if (this.ready && this.loop !== loop) this.player?.setLoop(loop);
    } catch {
      this.fail();
    }
    this.volume = volume;
    this.muted = muted;
    this.loop = loop;
  }

  setVolume(volume: number): void {
    this.previewAudioTouched = true;
    if (this.previewAutoMuted) {
      this.previewAutoMuted = false;
      try {
        if (this.ready && !this.muted) this.player?.unMute();
      } catch { this.fail(); return; }
    }
    this.configure(volume, this.muted, this.loop);
  }

  syncPreview(status: MediaStatus): void {
    if (!this.ready || !this.player || this.disposed || this.issue === "AUTOPLAY_BLOCKED" ||
        this.issue === "API_UNAVAILABLE") return;
    if (this.previewSource !== status.connectionId) {
      this.previewSource = status.connectionId;
      this.previewInitialized = false;
      this.previewActionAt = 0;
      this.previewRequestedState = null;
    }
    const now = Date.now();
    if (now - this.previewActionAt < 2000) return;
    const local = this.status();
    if (local.state === status.state) this.previewRequestedState = null;
    const actions = previewSyncActions(status, { position: local.position, state: local.state ?? "UNKNOWN" },
      this.previewInitialized, now);
    const stateAction = this.previewRequestedState === status.state ? null
      : actions.includes("play") ? "play" : actions.includes("pause") ? "pause" : null;
    if (status.player === "youtube" && status.state === "PLAYING" &&
        now - status.observedAt < 5000 && !this.previewAudioTouched && !this.previewAutoMuted) {
      try {
        this.player.mute();
        this.previewAutoMuted = true;
      } catch {
        this.fail();
        return;
      }
    }
    if (!actions.includes("seek") && !stateAction) return;
    try {
      if (actions.includes("seek")) {
        this.player.seekTo(previewTargetPosition(status, now), true);
        this.previewInitialized = true;
      }
      if (stateAction === "play") {
        this.player.playVideo();
        this.previewRequestedState = "PLAYING";
      } else if (stateAction === "pause") {
        this.player.pauseVideo();
        this.previewRequestedState = "PAUSED";
      }
      this.previewActionAt = now;
    } catch {
      this.previewActionAt = now;
      this.fail();
    }
  }

  setMuted(muted: boolean): void {
    this.configure(this.volume, muted, this.loop);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    listener();
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  run(command: Command, id: string | null = null, seconds?: number): void {
    if (this.disposed) return;
    if (command === "play" || command === "restart") this.previewAudioTouched = true;
    if ((command === "play" || command === "restart") && this.previewAutoMuted) {
      this.previewAutoMuted = false;
      try {
        if (this.ready && !this.muted) this.player?.unMute();
      } catch { this.fail(); return; }
    }
    this.state = "UNKNOWN";
    this.errorCode = null;
    this.issue = null;
    this.pending = { command, id, seconds, at: Date.now() };
    this.flush();
  }

  private flush(): void {
    if (!this.ready || !this.player || !this.pending) return;
    const { command, seconds } = this.pending;
    try {
      if (command === "play") this.player.playVideo();
      else if (command === "pause") this.player.pauseVideo();
      else if (command === "stop") {
        this.player.pauseVideo();
        this.player.seekTo(0, true);
        this.player.pauseVideo();
      }
      else if (command === "restart") {
        this.player.seekTo(0, true);
        this.player.playVideo();
      } else if (seconds !== undefined) this.player.seekTo(seconds, true);
    } catch {
      this.fail();
      return;
    }
    this.confirm();
  }

  private confirm(): void {
    if (!this.ready || !this.player || !this.pending) return;
    const { command, id, seconds, at } = this.pending;
    let state: PlayerState;
    let time: number;
    try {
      state = stateFromCode(this.player.getPlayerState());
      time = bounded(this.player.getCurrentTime());
    } catch {
      this.fail();
      return;
    }
    const confirmed = command === "play" ? state === "PLAYING" :
      command === "pause" ? state === "PAUSED" :
      command === "stop" ? state !== "PLAYING" && state !== "BUFFERING" && time <= 1 :
      command === "restart" ? state === "PLAYING" && time <= 2 :
      seconds !== undefined && Math.abs(time - seconds) <= 1.5;
    if (confirmed) {
      this.commandId = id;
      this.pending = null;
    } else if (Date.now() - at > 12_000) {
      this.pending = null;
      this.state = "ERROR";
      this.issue = "COMMAND_TIMEOUT";
    }
  }

  status(): Pick<MediaStatusInput, "position" | "duration" | "playing" | "state" | "errorCode" | "issue" | "commandId" | "player"> {
    let code: number | undefined;
    let position = 0;
    let duration = 0;
    try {
      code = this.ready ? this.player?.getPlayerState() : undefined;
      position = bounded(this.player?.getCurrentTime() ?? 0);
      duration = this.knownDuration(this.player?.getDuration() ?? 0);
    } catch {
      this.state = "ERROR";
      this.issue = "API_UNAVAILABLE";
    }
    const state = this.state === "ERROR" ? "ERROR" : code === undefined ? this.state : stateFromCode(code);
    return {
      position,
      duration,
      playing: state === "PLAYING",
      state,
      errorCode: this.errorCode,
      issue: this.issue,
      commandId: this.commandId,
      player: "youtube"
    };
  }

  private knownDuration(value: number): number {
    if (!Number.isFinite(value) || value <= 0 || value > 86400 || this.liveDuration) return 0;
    const now = Date.now();
    if (!this.durationSample) {
      this.durationSample = { value, at: now };
      return 0;
    }
    if (Math.abs(value - this.durationSample.value) > 0.5) {
      if (value > this.durationSample.value && now - this.durationSample.at >= 500) {
        this.liveDuration = true;
      }
      this.durationSample = { value, at: now };
      this.durationConfirmed = false;
      return 0;
    }
    if (now - this.durationSample.at >= 1000) this.durationConfirmed = true;
    return this.durationConfirmed ? value : 0;
  }

  private fail(): void {
    this.pending = null;
    this.state = "ERROR";
    this.issue = "API_UNAVAILABLE";
    this.notify();
  }

  dispose(): void {
    this.disposed = true;
    controllers.delete(this.frame);
    if (this.timer !== null) window.clearInterval(this.timer);
    try { this.player?.destroy(); } catch { /* The iframe may already be gone. */ }
    this.player = null;
    this.listeners.clear();
  }
}

export function youtubeController(frame: HTMLIFrameElement): YouTubePlayerController | undefined {
  return controllers.get(frame);
}
