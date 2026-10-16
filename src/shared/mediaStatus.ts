import { z } from "zod";

export const mediaStatusInputSchema = z.object({
  elementId: z.string().min(1).max(100),
  connectionId: z.string().min(1).max(100),
  position: z.number().finite().min(0).max(86400),
  duration: z.number().finite().min(0).max(86400),
  playing: z.boolean(),
  commandId: z.string().max(80).nullable(),
  player: z.enum(["html5", "youtube"]).optional(),
  state: z.enum(["PLAYING", "PAUSED", "BUFFERING", "ENDED", "UNSTARTED", "ERROR", "UNKNOWN"]).optional(),
  errorCode: z.number().int().refine((value) => [2, 5, 100, 101, 150, 153].includes(value)).nullable().optional(),
  issue: z.enum(["AUTOPLAY_BLOCKED", "API_UNAVAILABLE", "COMMAND_TIMEOUT"]).nullable().optional()
}).strict();

export type MediaStatusInput = z.infer<typeof mediaStatusInputSchema>;
export type MediaStatus = MediaStatusInput & { observedAt: number };
