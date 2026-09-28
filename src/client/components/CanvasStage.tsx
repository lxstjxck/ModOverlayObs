import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
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
  onSelect?: (id: string) => void;
  onUpdate?: (id: string, patch: Partial<OverlayElement>) => void;
  onTransientUpdate?: (id: string, patch: Partial<OverlayElement>) => void;
  onCommitUpdate?: (id: string, patch: Partial<OverlayElement>) => void;
}

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type ElementBounds = Pick<OverlayElement, "x" | "y" | "width" | "height">;
const SNAP_DISTANCE_PX = 10;

interface DragState {
  kind: "move" | "resize";
  handle?: ResizeHandle;
  id: string;
  startX: number;
  startY: number;
  original: OverlayElement;
  rect: DOMRect;
}

interface PanDrag {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

export function CanvasStage({
  mode,
  streamer,
  elements,
  selectedId,
  onSelect,
  onUpdate,
  onTransientUpdate,
  onCommitUpdate
}: CanvasStageProps) {
  const canEdit = mode === "workspace" && Boolean(onTransientUpdate ?? onUpdate);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panDrag = useRef<PanDrag | null>(null);
  const zoomRef = useRef(1);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stagingSide = Math.max(540, Math.round(streamer.canvasWidth * 0.3));
  const stagingTop = Math.max(170, Math.round(streamer.canvasHeight * 0.16));
  const stagingBottom = Math.max(390, Math.round(streamer.canvasHeight * 0.36));
  const fitScale = calculateFitScale(
    viewportSize.width,
    viewportSize.height,
    streamer.canvasWidth,
    streamer.canvasHeight
  );
  const scale = fitScale * zoom;

  useLayoutEffect(() => {
    if (!viewportRef.current) return;
    const viewport = viewportRef.current;
    const measure = () => {
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(viewport);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "workspace" || !viewportRef.current) return;
    const viewport = viewportRef.current;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const current = zoomRef.current;
        const next = Math.min(6, Math.max(0.25, current * Math.exp(-event.deltaY * 0.0015)));
        if (next === current) return;
        const rect = viewport.getBoundingClientRect();
        const focusX = event.clientX - rect.left - rect.width / 2;
        const focusY = event.clientY - rect.top - rect.height / 2;
        const ratio = next / current;
        setPan((previous) => ({
          x: focusX - (focusX - previous.x) * ratio,
          y: focusY - (focusY - previous.y) * ratio
        }));
        zoomRef.current = next;
        setZoom(next);
      } else {
        setPan((previous) => ({
          x: previous.x - (event.shiftKey ? event.deltaY : event.deltaX),
          y: previous.y - (event.shiftKey ? 0 : event.deltaY)
        }));
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [mode]);

  const overlayGeometry = calculateOverlayGeometry(
    viewportSize.width,
    viewportSize.height,
    streamer.canvasWidth,
    streamer.canvasHeight
  );
  const surfaceStyle: CSSProperties =
    mode === "workspace"
      ? {
          width: streamer.canvasWidth,
          height: streamer.canvasHeight,
          left:
            viewportSize.width / 2 +
            pan.x +
            ((stagingSide - 100 - streamer.canvasWidth) * scale) / 2,
          top:
            viewportSize.height / 2 +
            pan.y +
            ((stagingTop - stagingBottom - streamer.canvasHeight) * scale) / 2,
          transform: `scale(${scale})`
        }
      : {
          width: streamer.canvasWidth,
          height: streamer.canvasHeight,
          left: overlayGeometry.left,
          top: overlayGeometry.top,
          transform: `scale(${overlayGeometry.scale})`,
          transformOrigin: "top left"
        };

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (mode !== "workspace" || (event.button !== 0 && event.button !== 1)) return;
    if (event.button === 0 && (event.target as HTMLElement).closest(".stage-element")) return;
    event.preventDefault();
    panDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: pan.x,
      y: pan.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = panDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({ x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY });
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (panDrag.current?.pointerId !== event.pointerId) return;
    panDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function startDrag(
    event: ReactPointerEvent<HTMLElement>,
    element: OverlayElement,
    kind: DragState["kind"],
    handle?: ResizeHandle
  ) {
    if (event.button !== 0) return;
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
    let latestPatch: Partial<OverlayElement> | null = null;

    function handleMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = ((moveEvent.clientX - drag.startX) / drag.rect.width) * streamer.canvasWidth;
      const dy = ((moveEvent.clientY - drag.startY) / drag.rect.height) * streamer.canvasHeight;
      const thresholdX = (SNAP_DISTANCE_PX * streamer.canvasWidth) / drag.rect.width;
      const thresholdY = (SNAP_DISTANCE_PX * streamer.canvasHeight) / drag.rect.height;
      if (drag.kind === "move") {
        const position = {
          x: drag.original.x + dx,
          y: drag.original.y + dy
        };
        latestPatch =
          drag.original.type === "TEXT" ||
          moveEvent.altKey ||
          moveEvent.ctrlKey ||
          moveEvent.metaKey
            ? position
            : snapMoveToCanvasEdges(
                { ...drag.original, ...position },
                streamer.canvasWidth,
                streamer.canvasHeight,
                thresholdX,
                thresholdY
              );
      } else {
        const resized = resizeElement(drag.original, drag.handle ?? "se", dx, dy, moveEvent);
        latestPatch =
          drag.original.type === "TEXT" ||
          moveEvent.altKey ||
          moveEvent.shiftKey ||
          moveEvent.ctrlKey ||
          moveEvent.metaKey ||
          resized.x === undefined ||
          resized.y === undefined ||
          resized.width === undefined ||
          resized.height === undefined
            ? resized
            : snapResizeToCanvasEdges(
                { x: resized.x, y: resized.y, width: resized.width, height: resized.height },
                drag.handle ?? "se",
                streamer.canvasWidth,
                streamer.canvasHeight,
                thresholdX,
                thresholdY
              );
      }
      (onTransientUpdate ?? onUpdate)?.(drag.id, latestPatch);
    }

    function handleUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      handleMove(upEvent);
      if (latestPatch) onCommitUpdate?.(drag.id, latestPatch);
      currentTarget.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }

  return (
    <section className={`stage-shell stage-${mode}`}>
      <div
        className="stage-scroll"
        ref={viewportRef}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        {mode === "workspace" && (
          <div className="stage-zoom-indicator">{Math.round(scale * 100)}% · Ctrl + колесо</div>
        )}
        <div
          className="stage-surface"
          data-stage-mode={mode}
          style={surfaceStyle}
          onPointerDown={(event) => {
            if (mode === "workspace" && event.button === 0) {
              onSelect?.("");
            }
          }}
        >
          {mode === "workspace" && <WorkspaceZones />}
          {sortElements(elements).map((element) => (
            <div
              key={element.id}
              data-stage-element-id={element.id}
              className={`stage-element ${selectedId === element.id ? "selected" : ""} ${
                element.visible ? "" : "is-hidden"
              }`}
              style={{
                left: `${(element.x / streamer.canvasWidth) * 100}%`,
                top: `${(element.y / streamer.canvasHeight) * 100}%`,
                width: `${(element.width / streamer.canvasWidth) * 100}%`,
                height: `${(element.height / streamer.canvasHeight) * 100}%`,
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

export function calculateFitScale(
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number
): number {
  if (viewportWidth <= 0 || viewportHeight <= 0) return 1;
  const side = Math.max(540, Math.round(canvasWidth * 0.3));
  const top = Math.max(170, Math.round(canvasHeight * 0.16));
  const bottom = Math.max(390, Math.round(canvasHeight * 0.36));
  return Math.min(
    (viewportWidth - 48) / (canvasWidth + side + 100),
    (viewportHeight - 48) / (canvasHeight + top + bottom),
    1
  );
}

export function calculateOverlayGeometry(
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number
): { scale: number; left: number; top: number } {
  if (viewportWidth <= 0 || viewportHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return { scale: 1, left: 0, top: 0 };
  }
  const scale = Math.min(viewportWidth / canvasWidth, viewportHeight / canvasHeight);
  return {
    scale,
    left: (viewportWidth - canvasWidth * scale) / 2,
    top: (viewportHeight - canvasHeight * scale) / 2
  };
}

function nearestEdgeCorrection(
  edgePositions: number[],
  canvasSize: number,
  threshold: number
): number {
  const corrections = edgePositions.flatMap((position) => [-position, canvasSize - position]);
  const nearest = corrections.reduce(
    (best, correction) => (Math.abs(correction) < Math.abs(best) ? correction : best),
    Number.POSITIVE_INFINITY
  );
  return Math.abs(nearest) <= threshold ? nearest : 0;
}

export function snapMoveToCanvasEdges(
  bounds: ElementBounds,
  canvasWidth: number,
  canvasHeight: number,
  thresholdX: number,
  thresholdY: number
): Pick<ElementBounds, "x" | "y"> {
  return {
    x:
      bounds.x +
      nearestEdgeCorrection([bounds.x, bounds.x + bounds.width], canvasWidth, thresholdX),
    y:
      bounds.y +
      nearestEdgeCorrection([bounds.y, bounds.y + bounds.height], canvasHeight, thresholdY)
  };
}

export function snapResizeToCanvasEdges(
  bounds: ElementBounds,
  handle: ResizeHandle,
  canvasWidth: number,
  canvasHeight: number,
  thresholdX: number,
  thresholdY: number
): ElementBounds {
  let { x, y, width, height } = bounds;
  if (handle.includes("e")) {
    const correction = nearestEdgeCorrection([x + width], canvasWidth, thresholdX);
    if (width + correction >= 8) width += correction;
  } else if (handle.includes("w")) {
    const correction = nearestEdgeCorrection([x], canvasWidth, thresholdX);
    if (width - correction >= 8) {
      x += correction;
      width -= correction;
    }
  }
  if (handle.includes("s")) {
    const correction = nearestEdgeCorrection([y + height], canvasHeight, thresholdY);
    if (height + correction >= 8) height += correction;
  } else if (handle.includes("n")) {
    const correction = nearestEdgeCorrection([y], canvasHeight, thresholdY);
    if (height - correction >= 8) {
      y += correction;
      height -= correction;
    }
  }
  return { x, y, width, height };
}

function WorkspaceZones() {
  return (
    <>
      <div className="canvas-zone spawn-zone">
        <span>SPAWN</span>
      </div>
      <div className="canvas-zone stage-zone">
        <span>STAGE</span>
      </div>
      <div className="canvas-zone live-zone">
        <SafeGuides />
      </div>
    </>
  );
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

export function resizeElement(
  original: OverlayElement,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  event: Pick<PointerEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">
): Partial<OverlayElement> {
  if (event.altKey) {
    return { props: applyCrop(original, handle, dx, dy) };
  }

  const fromCenter = event.ctrlKey || event.metaKey;
  const preserveAspect = event.shiftKey && handle.length === 2;
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
    x,
    y,
    width,
    height
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
