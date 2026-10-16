// Socket.IO reconnects after transport failures. Only a server-initiated
// disconnect is final for an already connected overlay.
export function shouldClearOverlayOnDisconnect(reason: string): boolean {
  return reason === "io server disconnect";
}

export function shouldClearOverlayOnConnectError(message: string): boolean {
  return message === "Invalid overlay token" || message === "Twitch authentication required";
}
