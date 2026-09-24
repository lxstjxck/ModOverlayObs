import { z } from "zod";

export const animationSchema = z
  .enum(["none", "fade", "scale", "slide-left", "slide-right", "slide-up", "slide-down"])
  .default("none");

export const elementPatchSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    text: z.string().max(4000).nullable().optional(),
    x: z.number().finite().min(-10000).max(10000).optional(),
    y: z.number().finite().min(-10000).max(10000).optional(),
    width: z.number().finite().min(8).max(10000).optional(),
    height: z.number().finite().min(8).max(10000).optional(),
    rotation: z.number().finite().min(-3600).max(3600).optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    zIndex: z.number().int().min(-1000).max(1000).optional(),
    visible: z.boolean().optional(),
    durationMs: z
      .number()
      .int()
      .min(100)
      .max(24 * 60 * 60 * 1000)
      .nullable()
      .optional(),
    animationIn: animationSchema.optional(),
    animationOut: animationSchema.optional(),
    previewVolume: z.number().finite().min(0).max(1).optional(),
    liveVolume: z.number().finite().min(0).max(1).optional(),
    muted: z.boolean().optional(),
    loop: z.boolean().optional(),
    startTime: z
      .number()
      .finite()
      .min(0)
      .max(24 * 60 * 60)
      .optional(),
    props: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const previewAddSchema = z
  .object({
    mediaId: z.string().min(1).optional(),
    type: z.enum(["TEXT"]).optional(),
    text: z.string().max(4000).optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional()
  })
  .strict()
  .refine((value) => Boolean(value.mediaId) || value.type === "TEXT", {
    message: "mediaId or text type is required"
  });

export const mediaUrlSchema = z
  .object({
    url: z.string().url().max(2048),
    type: z.enum(["IMAGE", "GIF", "VIDEO", "AUDIO"]),
    name: z.string().trim().min(1).max(180).optional()
  })
  .strict()
  .refine((value) => {
    try {
      const parsed = new URL(value.url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "Only http:// and https:// media URLs are allowed");

export const idSchema = z.object({ id: z.string().min(1) }).strict();
export const liveShowSchema = z.object({ previewId: z.string().min(1) }).strict();
export const liveUpdateSchema = z
  .object({
    liveId: z.string().min(1),
    previewId: z.string().min(1).optional(),
    patch: elementPatchSchema.optional()
  })
  .strict();

export const loginSchema = z
  .object({
    username: z.string().trim().min(1).max(80),
    password: z.string().min(1).max(256)
  })
  .strict();
