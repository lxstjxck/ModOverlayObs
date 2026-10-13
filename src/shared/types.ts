export type Role = "OWNER" | "ADMIN_MODERATOR" | "MODERATOR";
export type MediaType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO";
export type ElementType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO" | "TEXT";
export type AnimationName =
  "none" | "fade" | "scale" | "slide-left" | "slide-right" | "slide-up" | "slide-down";

export type PermissionFlag =
  | "canUploadImage"
  | "canUploadGif"
  | "canUploadVideo"
  | "canUploadAudio"
  | "canCreateText"
  | "canEditPreview"
  | "canPushLive"
  | "canRemoveLive"
  | "canClearLive"
  | "canDeleteMedia";

export type PermissionMap = Record<PermissionFlag, boolean>;

export interface UserView {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  permissions: PermissionMap;
}

export type TwitchMode = "streamer" | "moderator";
export type ChannelStatus = "connected" | "unconnected" | "denied" | "error";

export interface TwitchProfileView {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface TwitchChannelView {
  id: string | null;
  twitchId: string;
  displayName: string;
  avatarUrl: string | null;
  status: ChannelStatus;
}

export interface TwitchModeratorView {
  id: string;
  twitchUserId: string;
  displayName: string;
  twitchAvatarUrl: string | null;
  banned: boolean;
}

export interface StreamerView {
  id: string;
  displayName: string;
  canvasWidth: number;
  canvasHeight: number;
  canvasRevision: string;
  overlayToken?: string;
  twitchLogin?: string | null;
  twitchBroadcasterId?: string | null;
}

export type CanvasChangeMode = "keep" | "scale";

export interface CanvasSettingsInput {
  width: number;
  height: number;
  mode: CanvasChangeMode;
  expectedRevision: string;
}

export type EmoteProviderName = "twitch" | "7tv" | "custom";

export interface ChannelEmote {
  id: string;
  provider: EmoteProviderName;
  name: string;
  animated: boolean;
  previewUrl: string;
  sourceUrl: string;
  width?: number;
  height?: number;
}

export interface ChannelEmotesResponse {
  twitch: ChannelEmote[];
  sevenTv: ChannelEmote[];
  custom: ChannelEmote[];
  errors: { twitch?: string; sevenTv?: string };
}

export interface MediaItem {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  type: MediaType;
  size: number;
  url: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

export interface OverlayElement {
  id: string;
  previewElementId?: string | null;
  mediaId?: string | null;
  type: ElementType;
  name: string;
  src?: string | null;
  text?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  visible: boolean;
  durationMs?: number | null;
  animationIn: AnimationName;
  animationOut: AnimationName;
  previewVolume?: number;
  liveVolume: number;
  muted: boolean;
  loop: boolean;
  startTime: number;
  startedAt?: string;
  endsAt?: string | null;
  props: Record<string, unknown>;
}

export interface ElementTransform {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  crop?: { left: number; right: number; top: number; bottom: number };
}

export interface PresenceState {
  overlayConnected: boolean;
  overlayCount: number;
  moderators: Array<{ id: string; displayName: string }>;
}

export interface OverlayReloadStatus {
  id: string;
  state: "waiting" | "completed" | "timed_out";
  total: number;
  received: number;
  reconnected: number;
}

export interface ObsSetupView {
  overlayUrl: string;
  canvasWidth: number;
  canvasHeight: number;
}

export interface TtsSetupView {
  available: boolean;
  configured: boolean;
  connected: boolean;
  enabled: boolean;
  error: string | null;
  queueLength: number;
  broadcasterLogin: string | null;
  rewardId: string | null;
  rewardCost: number;
  ready: boolean;
}

export const permissionFlags: PermissionFlag[] = [
  "canUploadImage",
  "canUploadGif",
  "canUploadVideo",
  "canUploadAudio",
  "canCreateText",
  "canEditPreview",
  "canPushLive",
  "canRemoveLive",
  "canClearLive",
  "canDeleteMedia"
];

export const defaultPermissionsByRole: Record<Role, PermissionMap> = {
  OWNER: Object.fromEntries(permissionFlags.map((flag) => [flag, true])) as PermissionMap,
  ADMIN_MODERATOR: Object.fromEntries(permissionFlags.map((flag) => [flag, true])) as PermissionMap,
  MODERATOR: {
    canUploadImage: true,
    canUploadGif: true,
    canUploadVideo: true,
    canUploadAudio: true,
    canCreateText: true,
    canEditPreview: true,
    canPushLive: true,
    canRemoveLive: true,
    canClearLive: false,
    canDeleteMedia: false
  }
};
