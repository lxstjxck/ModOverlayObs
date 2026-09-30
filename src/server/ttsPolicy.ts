export const ttsTextLimit = 200;

export interface TwitchChatMessage {
  broadcaster_user_id?: unknown;
  chatter_user_id?: unknown;
  message?: { text?: unknown };
  badges?: Array<{ set_id?: unknown }>;
  channel_points_custom_reward_id?: unknown;
  source_broadcaster_user_id?: unknown;
}

export function moderatorTtsText(event: TwitchChatMessage, broadcasterId: string): string | null {
  if (event.broadcaster_user_id !== broadcasterId) return null;
  if (event.source_broadcaster_user_id) return null;
  if (event.channel_points_custom_reward_id) return null;
  if (
    event.chatter_user_id !== broadcasterId &&
    !event.badges?.some(
      (badge) => badge.set_id === "moderator" || badge.set_id === "lead_moderator"
    )
  )
    return null;
  if (typeof event.message?.text !== "string") return null;
  const match = /^!tts(?:\s+|$)([\s\S]*)$/i.exec(event.message.text.trim());
  return match ? cleanTtsText(match[1]) : null;
}

export function cleanTtsText(value: string): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 && text.length <= ttsTextLimit ? text : null;
}

export function redemptionTtsText(
  event: Record<string, unknown>,
  broadcasterId: string,
  rewardId: string | null
): string | null {
  const reward = event.reward as { id?: unknown } | undefined;
  if (
    !rewardId ||
    event.broadcaster_user_id !== broadcasterId ||
    reward?.id !== rewardId ||
    (event.status !== undefined && event.status !== "unfulfilled") ||
    typeof event.id !== "string" ||
    typeof event.user_id !== "string" ||
    typeof event.user_input !== "string"
  )
    return null;
  return cleanTtsText(event.user_input);
}
