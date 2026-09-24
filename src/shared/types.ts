export type Role = "OWNER" | "ADMIN_MODERATOR" | "MODERATOR";
export type MediaType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO";
export type ElementType = "IMAGE" | "GIF" | "VIDEO" | "AUDIO" | "TEXT";
export type AnimationName =
  | "none"
  | "fade"
  | "scale"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down";

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

export interface StreamerView {
  id: string;
  displayName: string;
  canvasWidth: number;
  canvasHeight: number;
  overlayToken?: string;
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

export interface PresenceState {
  overlayConnected: boolean;
  overlayCount: number;
  moderators: Array<{ id: string; displayName: string }>;
}

export interface ObsSetupView {
  overlayUrl: string;
  canvasWidth: number;
  canvasHeight: number;
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
