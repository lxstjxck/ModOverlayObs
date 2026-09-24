import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { EyeOff } from "lucide-react";
import { buildYouTubeEmbedUrl } from "../../shared/mediaUrl";
import type { OverlayElement, StreamerView } from "../../shared/types";
import { setMediaNodeMuted, setMediaNodeVolume } from "../mediaPlayback";
import { sortElements } from "../utils";

interface CanvasStageProps {
  mode: "workspace" | "overlay";
  streamer: StreamerView;
  elements: OverlayElement[];
  selectedId?: string | null;
  zoom: "fit" | 0.25 | 0.5 | 0.75 | 1;
  onSelect?: (id: string) => void;
  onUpdate?: (id: string, patch: Partial<OverlayElement>) => void;
}

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface StageBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
  liveLeft: number;
  liveTop: number;
}

interface DragState {
  kind: "move" | "resize";
  handle?: ResizeHandle;
  id: string;
  startX: number;
  startY: number;
  original: OverlayElement;
  rect: DOMRect;
}

export function CanvasStage({
  mode,
  streamer,
  elements,
  selectedId,
  zoom,
  onSelect,
  onUpdate
}: CanvasStageProps) {
  const canEdit = mode === "workspace" && Boolean(onUpdate);
  const bounds = getStageBounds(streamer, mode);
  const canvasStyle =
    zoom === "fit"
      ? undefined
      : {
          width: `${bounds.width * zoom}px`,
          minWidth: `${bounds.width * zoom}px`
        };

  function startDrag(
    event: ReactPointerEvent<HTMLElement>,
    element: OverlayElement,
    kind: DragState["kind"],
    handle?: ResizeHandle
  ) {
    if (!canEdit) {
      onSelect?.(element.id);
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("audio") || target.closest("[contenteditable=true]")) {
      return;
    }
    const stage = event.currentTarget.closest(".stage-surface");
    if (!(stage instanceof HTMLElement)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(element.id);
    const drag: DragState = {
      kind,
      handle,
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      original: element,
      rect: stage.getBoundingClientRect()
    };
    const pointerId = event.pointerId;
    const currentTarget = event.currentTarget;
    currentTarget.setPointerCapture(pointerId);

    function handleMove(moveEvent: PointerEvent) {
      const dx = ((moveEvent.clientX - drag.startX) / drag.rect.width) * bounds.width;
      const dy = ((moveEvent.clientY - drag.startY) / drag.rect.height) * bounds.height;
      if (drag.kind === "move") {
        const next = applyMoveSnap(
          {
            x: drag.original.x + dx,
            y: drag.original.y + dy,
            width: drag.original.width,
            height: drag.original.height
          },
          {
            streamer,
            elements,
            activeId: drag.id,
            threshold: (12 / drag.rect.width) * bounds.width,
            disabled: moveEvent.shiftKey
          }
        );
        onUpdate?.(drag.id, {
          x: Math.round(next.x),
          y: Math.round(next.y)
        });
      } else {
        const resized = resizeElement(drag.original, drag.handle ?? "se", dx, dy, moveEvent);
        onUpdate?.(
          drag.id,
          "props" in resized
            ? resized
            : applyResizeSnap(resized, {
                streamer,
                threshold: (12 / drag.rect.width) * bounds.width,
                disabled: moveEvent.altKey
              })
        );
      }
    }

    function handleUp() {
      currentTarget.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <section className={`stage-shell stage-${mode}`}>
      <div className="stage-scroll">
        <div
          className="stage-surface"
          data-stage-mode={mode}
          style={{
            aspectRatio: `${bounds.width} / ${bounds.height}`,
            ...canvasStyle
          }}
          onPointerDown={() => {
            if (mode === "workspace") {
              onSelect?.("");
            }
          }}
        >
          {mode === "workspace" && <WorkspaceZones streamer={streamer} bounds={bounds} />}
          {sortElements(elements).map((element) => (
            <div
              key={element.id}
              className={`stage-element ${selectedId === element.id ? "selected" : ""} ${
                element.visible ? "" : "is-hidden"
              }`}
              style={{
                left: `${((element.x - bounds.minX) / bounds.width) * 100}%`,
                top: `${((element.y - bounds.minY) / bounds.height) * 100}%`,
                width: `${(element.width / bounds.width) * 100}%`,
                height: `${(element.height / bounds.height) * 100}%`,
                opacity: element.opacity,
                zIndex: element.zIndex + 1000,
                transform: `rotate(${element.rotation}deg)`
              }}
              onPointerDown={(event) => startDrag(event, element, "move")}
            >
              <ElementContent mode={mode} element={element} />
              {mode === "workspace" && selectedId === element.id && (
                <ResizeHandles
                  onStart={(event, handle) => startDrag(event, element, "resize", handle)}
                />
              )}
              {mode === "workspace" && !element.visible && (
                <span className="hidden-pill">
                  <EyeOff size={12} /> Hidden
                </span>
              )}
            </div>
          ))}
          {mode === "workspace" && elements.length === 0 && (
            <div className="empty-stage">No assets</div>
          )}
        </div>
      </div>
    </section>
  );
}

function getStageBounds(streamer: StreamerView, mode: CanvasStageProps["mode"]): StageBounds {
  if (mode === "overlay") {
    return {
      minX: 0,
      minY: 0,
      width: streamer.canvasWidth,
      height: streamer.canvasHeight,
      liveLeft: 0,
      liveTop: 0
    };
  }

  const side = Math.max(540, Math.round(streamer.canvasWidth * 0.3));
  const top = Math.max(170, Math.round(streamer.canvasHeight * 0.16));
  const bottom = Math.max(390, Math.round(streamer.canvasHeight * 0.36));
  return {
    minX: -side,
    minY: -top,
    width: streamer.canvasWidth + side * 2,
    height: streamer.canvasHeight + top + bottom,
    liveLeft: side,
    liveTop: top
  };
}

function WorkspaceZones({ streamer, bounds }: { streamer: StreamerView; bounds: StageBounds }) {
  const liveStyle: CSSProperties = {
    left: `${(bounds.liveLeft / bounds.width) * 100}%`,
    top: `${(bounds.liveTop / bounds.height) * 100}%`,
    width: `${(streamer.canvasWidth / bounds.width) * 100}%`,
    height: `${(streamer.canvasHeight / bounds.height) * 100}%`
  };
  const spawnStyle: CSSProperties = {
    left: "0%",
    top: `${(bounds.liveTop / bounds.height) * 100}%`,
    width: `${(bounds.liveLeft / bounds.width) * 100}%`,
    height: `${(streamer.canvasHeight / bounds.height) * 100}%`
  };
  const stageStyle: CSSProperties = {
    left: `${(bounds.liveLeft / bounds.width) * 100}%`,
    top: `${((bounds.liveTop + streamer.canvasHeight) / bounds.height) * 100}%`,
    width: `${(streamer.canvasWidth / bounds.width) * 100}%`,
    height: `${((bounds.height - bounds.liveTop - streamer.canvasHeight) / bounds.height) * 100}%`
  };

  return (
    <>
      <div className="canvas-zone spawn-zone" style={spawnStyle}>
        <span>SPAWN</span>
      </div>
      <div className="canvas-zone stage-zone" style={stageStyle}>
        <span>STAGE</span>
      </div>
      <div className="canvas-zone live-zone" style={liveStyle}>
        <span>
          OBS {streamer.canvasWidth}x{streamer.canvasHeight}
        </span>
        <SafeGuides />
      </div>
    </>
  );
}

function applyMoveSnap(
  rect: { x: number; y: number; width: number; height: number },
  options: {
    streamer: StreamerView;
    elements: OverlayElement[];
    activeId: string;
    threshold: number;
    disabled: boolean;
  }
): { x: number; y: number } {
  if (options.disabled) {
    return { x: rect.x, y: rect.y };
  }
  const xTargets = [0, options.streamer.canvasWidth / 2, options.streamer.canvasWidth];
  const yTargets = [0, options.streamer.canvasHeight / 2, options.streamer.canvasHeight];
  for (const element of options.elements) {
    if (element.id === options.activeId || !element.visible) {
      continue;
    }
    xTargets.push(element.x, element.x + element.width / 2, element.x + element.width);
    yTargets.push(element.y, element.y + element.height / 2, element.y + element.height);
  }

  let x = rect.x;
  let y = rect.y;
  const horizontal = [
    { edge: rect.x, apply: (target: number) => target },
    { edge: rect.x + rect.width / 2, apply: (target: number) => target - rect.width / 2 },
    { edge: rect.x + rect.width, apply: (target: number) => target - rect.width }
  ];
  const vertical = [
    { edge: rect.y, apply: (target: number) => target },
    { edge: rect.y + rect.height / 2, apply: (target: number) => target - rect.height / 2 },
    { edge: rect.y + rect.height, apply: (target: number) => target - rect.height }
  ];
  const snapX = findSnap(horizontal, xTargets, options.threshold);
  const snapY = findSnap(vertical, yTargets, options.threshold);
  if (snapX !== null) {
    x = snapX;
  }
  if (snapY !== null) {
    y = snapY;
  }
  return { x, y };
}

function applyResizeSnap(
  patch: Partial<OverlayElement>,
  options: { streamer: StreamerView; threshold: number; disabled: boolean }
): Partial<OverlayElement> {
  if (
    options.disabled ||
    patch.x === undefined ||
    patch.y === undefined ||
    patch.width === undefined ||
    patch.height === undefined
  ) {
    return patch;
  }

  let x = patch.x;
  let y = patch.y;
  let width = patch.width;
  let height = patch.height;
  const minSize = 8;
  const right = x + width;
  const bottom = y + height;
  const xTargets = [0, options.streamer.canvasWidth / 2, options.streamer.canvasWidth];
  const yTargets = [0, options.streamer.canvasHeight / 2, options.streamer.canvasHeight];

  const leftSnap = closestTarget(x, xTargets, options.threshold);
  const rightSnap = closestTarget(right, xTargets, options.threshold);
  const centerSnap = closestTarget(x + width / 2, xTargets, options.threshold);
  if (leftSnap !== null) {
    width = Math.max(minSize, right - leftSnap);
    x = leftSnap;
  } else if (rightSnap !== null) {
    width = Math.max(minSize, rightSnap - x);
  } else if (centerSnap !== null) {
    x = centerSnap - width / 2;
  }

  const topSnap = closestTarget(y, yTargets, options.threshold);
  const bottomSnap = closestTarget(bottom, yTargets, options.threshold);
  const middleSnap = closestTarget(y + height / 2, yTargets, options.threshold);
  if (topSnap !== null) {
    height = Math.max(minSize, bottom - topSnap);
    y = topSnap;
  } else if (bottomSnap !== null) {
    height = Math.max(minSize, bottomSnap - y);
  } else if (middleSnap !== null) {
    y = middleSnap - height / 2;
  }

  return {
    ...patch,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function findSnap(
  edges: Array<{ edge: number; apply: (target: number) => number }>,
  targets: number[],
  threshold: number
): number | null {
  let best: { distance: number; value: number } | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const distance = Math.abs(edge.edge - target);
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { distance, value: edge.apply(target) };
      }
    }
  }
  return best?.value ?? null;
}

function closestTarget(value: number, targets: number[], threshold: number): number | null {
  let best: { distance: number; target: number } | null = null;
  for (const target of targets) {
    const distance = Math.abs(value - target);
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { distance, target };
    }
  }
  return best?.target ?? null;
}

function ResizeHandles({
  onStart
}: {
  onStart: (event: ReactPointerEvent<HTMLElement>, handle: ResizeHandle) => void;
}) {
  const handles: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  return (
    <>
      {handles.map((handle) => (
        <button
          key={handle}
          className={`resize-handle resize-${handle}`}
          type="button"
          aria-label={`Resize ${handle}`}
          onPointerDown={(event) => onStart(event, handle)}
        />
      ))}
    </>
  );
}

function resizeElement(
  original: OverlayElement,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  event: PointerEvent
): Partial<OverlayElement> {
  if (event.altKey) {
    return { props: applyCrop(original, handle, dx, dy) };
  }

  const fromCenter = event.ctrlKey || event.metaKey;
  const preserveAspect = !event.shiftKey && handle.length === 2;
  const minSize = 8;
  const centerX = original.x + original.width / 2;
  const centerY = original.y + original.height / 2;
  const hasWest = handle.includes("w");
  const hasEast = handle.includes("e");
  const hasNorth = handle.includes("n");
  const hasSouth = handle.includes("s");

  let leftDelta = hasWest ? dx : 0;
  let rightDelta = hasEast ? dx : 0;
  let topDelta = hasNorth ? dy : 0;
  let bottomDelta = hasSouth ? dy : 0;

  if (fromCenter) {
    leftDelta = hasWest ? dx : hasEast ? -dx : 0;
    rightDelta = hasEast ? dx : hasWest ? -dx : 0;
    topDelta = hasNorth ? dy : hasSouth ? -dy : 0;
    bottomDelta = hasSouth ? dy : hasNorth ? -dy : 0;
  }

  let x = original.x + leftDelta;
  let y = original.y + topDelta;
  let width = Math.max(minSize, original.width + rightDelta - leftDelta);
  let height = Math.max(minSize, original.height + bottomDelta - topDelta);

  if (preserveAspect) {
    const ratio = original.width / Math.max(1, original.height);
    const widthChange = Math.abs(width / original.width - 1);
    const heightChange = Math.abs(height / original.height - 1);
    if (widthChange >= heightChange) {
      height = Math.max(minSize, width / ratio);
    } else {
      width = Math.max(minSize, height * ratio);
    }

    if (fromCenter) {
      x = centerX - width / 2;
      y = centerY - height / 2;
    } else {
      x = hasWest ? original.x + original.width - width : original.x;
      y = hasNorth ? original.y + original.height - height : original.y;
    }
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function applyCrop(
  original: OverlayElement,
  handle: ResizeHandle,
  dx: number,
  dy: number
): Record<string, unknown> {
  const crop = getCrop(original);
  const next = { ...crop };
  if (handle.includes("w")) {
    next.left += dx;
  }
  if (handle.includes("e")) {
    next.right -= dx;
  }
  if (handle.includes("n")) {
    next.top += dy;
  }
  if (handle.includes("s")) {
    next.bottom -= dy;
  }
  next.left = clamp(next.left, 0, Math.max(0, original.width - 1));
  next.right = clamp(next.right, 0, Math.max(0, original.width - 1 - next.left));
  next.top = clamp(next.top, 0, Math.max(0, original.height - 1));
  next.bottom = clamp(next.bottom, 0, Math.max(0, original.height - 1 - next.top));
  return {
    ...original.props,
    cropLeft: Math.round(next.left),
    cropRight: Math.round(next.right),
    cropTop: Math.round(next.top),
    cropBottom: Math.round(next.bottom)
  };
}

function getCrop(element: OverlayElement): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  return {
    left: getNumberProp(element.props, "cropLeft", 0),
    right: getNumberProp(element.props, "cropRight", 0),
    top: getNumberProp(element.props, "cropTop", 0),
    bottom: getNumberProp(element.props, "cropBottom", 0)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function SafeGuides() {
  return (
    <>
      <div className="safe safe-5" />
      <div className="safe safe-10" />
      <div className="center-guide x" />
      <div className="center-guide y" />
    </>
  );
}

function ElementContent({
  element,
  mode
}: {
  element: OverlayElement;
  mode: CanvasStageProps["mode"];
}) {
  if (element.type === "TEXT") {
    const props = element.props;
    const color = getStringProp(props, "color", "#ffffff");
    const background = getStringProp(props, "background", "transparent");
    const fontSize = getNumberProp(props, "fontSize", 46);
    const fontFamily = getStringProp(props, "fontFamily", "Inter, Arial, sans-serif");
    const fontWeight = getNumberProp(props, "fontWeight", 800);
    const stroke = getStringProp(props, "stroke", "#000000");
    const strokeWidth = getNumberProp(props, "strokeWidth", 0);
    const shadow = Boolean(props.shadow ?? true);
    return (
      <div
        className="text-element"
        style={{
          color,
          background,
          fontSize: `${fontSize}px`,
          fontFamily,
          fontWeight,
          WebkitTextStroke: strokeWidth > 0 ? `${strokeWidth}px ${stroke}` : undefined,
          textShadow: shadow ? "0 2px 10px rgba(0,0,0,.55)" : undefined,
          justifyContent:
            getStringProp(props, "align", "left") === "center" ? "center" : "flex-start"
        }}
      >
        {element.text}
      </div>
    );
  }

  if (element.type === "VIDEO" || element.type === "AUDIO") {
    const youtubeSrc = buildYouTubeEmbedUrl(element.src, {
      origin: getWindowOrigin()
    });
    if (youtubeSrc) {
      return (
        <iframe
          className="media-element video-frame"
          style={buildCropStyle(element)}
          data-preview-media-id={mode === "workspace" ? element.id : undefined}
          data-overlay-media-id={mode === "overlay" ? element.id : undefined}
          src={youtubeSrc}
          referrerPolicy="strict-origin-when-cross-origin"
          title={element.name}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          onLoad={(event) => {
            if (mode === "overlay") {
              setMediaNodeVolume(event.currentTarget, element.liveVolume);
              setMediaNodeMuted(event.currentTarget, element.muted);
            }
          }}
        />
      );
    }
  }

  if (element.type === "VIDEO") {
    return (
      <video
        className="media-element"
        style={buildCropStyle(element)}
        data-preview-media-id={mode === "workspace" ? element.id : undefined}
        data-overlay-media-id={mode === "overlay" ? element.id : undefined}
        src={element.src ?? undefined}
        muted={mode === "overlay" ? element.muted : false}
        loop={element.loop}
        autoPlay={false}
        preload="metadata"
        playsInline
      />
    );
  }

  if (element.type === "AUDIO") {
    return (
      <div className="audio-element">
        <div className="audio-title">{getStringProp(element.props, "title", element.name)}</div>
        <div className="audio-bars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <audio
          data-preview-media-id={mode === "workspace" ? element.id : undefined}
          data-overlay-media-id={mode === "overlay" ? element.id : undefined}
          src={element.src ?? undefined}
          controls={mode === "workspace"}
          muted={mode === "overlay" ? element.muted : false}
          loop={element.loop}
          autoPlay={false}
        />
      </div>
    );
  }

  return (
    <img
      className="media-element"
      style={buildCropStyle(element)}
      src={element.src ?? undefined}
      alt={element.name}
      draggable={false}
    />
  );
}

function buildCropStyle(element: OverlayElement): CSSProperties | undefined {
  const crop = getCrop(element);
  if (crop.left === 0 && crop.right === 0 && crop.top === 0 && crop.bottom === 0) {
    return undefined;
  }
  const top = (crop.top / Math.max(1, element.height)) * 100;
  const right = (crop.right / Math.max(1, element.width)) * 100;
  const bottom = (crop.bottom / Math.max(1, element.height)) * 100;
  const left = (crop.left / Math.max(1, element.width)) * 100;
  return {
    clipPath: `inset(${top}% ${right}% ${bottom}% ${left}%)`
  };
}

function getStringProp(props: Record<string, unknown>, key: string, fallback: string): string {
  return typeof props[key] === "string" ? props[key] : fallback;
}

function getNumberProp(props: Record<string, unknown>, key: string, fallback: number): number {
  return typeof props[key] === "number" ? props[key] : fallback;
}

function getWindowOrigin(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.origin;
}
