import { z } from "zod";

export const mediaStatusInputSchema = z.object({
  elementId: z.string().min(1).max(100),
  connectionId: z.string().min(1).max(100),
  position: z.number().finite().min(0).max(86400),
  duration: z.number().finite().min(0).max(86400),
  playing: z.boolean(),
  commandId: z.string().max(80).nullable()
}).strict();

export type MediaStatusInput = z.infer<typeof mediaStatusInputSchema>;
export type MediaStatus = MediaStatusInput & { observedAt: number };
