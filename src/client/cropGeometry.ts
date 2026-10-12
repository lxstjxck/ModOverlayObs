import type { OverlayElement } from "../shared/types";

export interface CropInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function inset(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function getCrop(element: OverlayElement): CropInsets {
  return {
    left: inset(element.props.cropLeft),
    right: inset(element.props.cropRight),
    top: inset(element.props.cropTop),
    bottom: inset(element.props.cropBottom)
  };
}

export function scaleCrop(
  element: OverlayElement,
  width: number,
  height: number
): Record<string, unknown> | undefined {
  const crop = getCrop(element);
  if (Object.values(crop).every((value) => value === 0)) return undefined;
  const scaleX = width / Math.max(1, element.width);
  const scaleY = height / Math.max(1, element.height);
  return {
    ...element.props,
    cropLeft: crop.left * scaleX,
    cropRight: crop.right * scaleX,
    cropTop: crop.top * scaleY,
    cropBottom: crop.bottom * scaleY
  };
}

export function cropClipPath(crop: CropInsets, width: number, height: number): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return `inset(${(crop.top / h) * 100}% ${(crop.right / w) * 100}% ${(crop.bottom / h) * 100}% ${(crop.left / w) * 100}%)`;
}
