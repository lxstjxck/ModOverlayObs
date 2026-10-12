import type { MediaItem, OverlayElement, StreamerView } from "../shared/types";
import { scaleCrop } from "./cropGeometry";
import { sortElements } from "./utils";

export type CanvasTransformCommand = "reset" | "fit" | "stretch" | "center";

export function transformCommand(
  element: OverlayElement,
  streamer: StreamerView,
  command: CanvasTransformCommand,
  media?: Pick<MediaItem, "width" | "height">
): Partial<OverlayElement> {
  const { canvasWidth, canvasHeight } = streamer;
  if (command === "center") {
    return { x: (canvasWidth - element.width) / 2, y: (canvasHeight - element.height) / 2 };
  }
  if (command === "reset") {
    const width = Math.max(
      8,
      Math.min(10000, media?.width ?? (element.type === "TEXT" ? 420 : element.width))
    );
    const height = Math.max(
      8,
      Math.min(10000, media?.height ?? (element.type === "TEXT" ? 96 : element.height))
    );
    return {
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      props: { ...element.props, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 }
    };
  }
  const factor =
    command === "fit" ? Math.min(canvasWidth / element.width, canvasHeight / element.height) : 1;
  const width = command === "fit" ? element.width * factor : canvasWidth;
  const height = command === "fit" ? element.height * factor : canvasHeight;
  const props = scaleCrop(element, width, height);
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
    ...(props ? { props } : {})
  };
}

export function layerOrderPatches(
  elements: OverlayElement[],
  id: string,
  direction: "up" | "down" | "top" | "bottom"
): Array<{ id: string; zIndex: number }> {
  const sorted = sortElements(elements);
  const index = sorted.findIndex((item) => item.id === id);
  if (index < 0) return [];
  const target =
    direction === "up"
      ? Math.min(sorted.length - 1, index + 1)
      : direction === "down"
        ? Math.max(0, index - 1)
        : direction === "top"
          ? sorted.length - 1
          : 0;
  if (target === index) return [];
  const [item] = sorted.splice(index, 1);
  sorted.splice(target, 0, item);
  return sorted.map((entry, position) => ({ id: entry.id, zIndex: position + 1 }));
}

export function reversePatch(
  element: OverlayElement,
  patch: Partial<OverlayElement>
): Partial<OverlayElement> {
  const before: Partial<OverlayElement> = {};
  for (const key of Object.keys(patch) as Array<keyof OverlayElement>) {
    if (key === "props") before.props = element.props;
    else Object.assign(before, { [key]: element[key] });
  }
  return before;
}
