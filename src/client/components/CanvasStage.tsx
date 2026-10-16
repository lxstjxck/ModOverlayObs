import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { EyeOff } from "lucide-react";
import { buildYouTubeEmbedUrl, isRenderableMediaUrl, unsafeMediaUrlMessage } from "../../shared/mediaUrl";
import type { OverlayElement, StreamerView } from "../../shared/types";
import { cropClipPath, getCrop, scaleCrop } from "../cropGeometry";
import { sortElements } from "../utils";
import { YouTubePlayerController } from "../youtubePlayer";

interface CanvasStageProps {
  mode: "workspace" | "overlay";
  streamer: StreamerView;
  elements: OverlayElement[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onUpdate?: (id: string, patch: Partial<OverlayElement>) => void;
  onTransientUpdate?: (id: string, patch: Partial<OverlayElement>) => void;
  onCommitUpdate?: (id: string, patch: Partial<OverlayElement>, before: OverlayElement) => void;
}

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type ElementBounds = Pick<OverlayElement, "x" | "y" | "width" | "height">;
type SnapGuides = { left: boolean; right: boolean; top: boolean; bottom: boolean };
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
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const panDrag = useRef<PanDrag | null>(null);
  const activeDragCleanup = useRef<(() => void) | null>(null);
  const spacePressed = useRef(false);
  const zoomRef = useRef(1);
  const wheelCenterRef = useRef<{ x: number; y: number } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [snapGuides, setSnapGuides] = useState<SnapGuides | null>(null);
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

  useEffect(() => () => activeDragCleanup.current?.(), []);

  useEffect(() => {
    if (mode !== "workspace") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTypingTarget(event.target)) return;
      spacePressed.current = true;
      if (viewportRef.current?.matches(":hover")) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePressed.current = false;
    };
    const onBlur = () => {
      spacePressed.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [mode]);

  useLayoutEffect(() => {
    wheelCenterRef.current = null;
  }, [zoom, pan]);

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
      const surface = surfaceRef.current;
      if (!surface) return;
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      const center = wheelCenterRef.current ?? {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      // The workspace surface scales from its top-left corner.
      const stagingOffset = {
        x: (stagingSide - 100) / 2,
        y: (stagingTop - stagingBottom) / 2
      };
      const next = zoomAroundPointer(
        zoomRef.current,
        event.deltaY,
        event.clientX,
        event.clientY,
        center,
        fitScale,
        stagingOffset
      );
      if (next.zoom === zoomRef.current) return;
      const scaleDelta = (next.zoom - zoomRef.current) * fitScale;
      wheelCenterRef.current = {
        x: center.x + next.panDelta.x + stagingOffset.x * scaleDelta,
        y: center.y + next.panDelta.y + stagingOffset.y * scaleDelta
      };
      zoomRef.current = next.zoom;
      setPan((previous) => ({ x: previous.x + next.panDelta.x, y: previous.y + next.panDelta.y }));
      setZoom(next.zoom);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [
    mode,
    fitScale,
    stagingSide,
    stagingTop,
    stagingBottom,
    streamer.canvasWidth,
    streamer.canvasHeight
  ]);

  function setZoomPreset(percent: number | null) {
    const next = percent === null ? 1 : clamp(percent / fitScale, 0.25, 6);
    zoomRef.current = next;
    setZoom(next);
    setPan({ x: 0, y: 0 });
  }

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
    if (mode !== "workspace") return;
    const target = event.target as HTMLElement;
    if (
      !shouldStartPan(
        event.button,
        spacePressed.current,
        Boolean(target.closest(".stage-zoom-controls"))
      )
    )
      return;
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
    if (spacePressed.current) return;
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
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      if (currentTarget.hasPointerCapture(pointerId)) currentTarget.releasePointerCapture(pointerId);
      if (activeDragCleanup.current === cleanup) activeDragCleanup.current = null;
    };
    activeDragCleanup.current?.();
    activeDragCleanup.current = cleanup;

    function handleMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = ((moveEvent.clientX - drag.startX) / drag.rect.width) * streamer.canvasWidth;
      const dy = ((moveEvent.clientY - drag.startY) / drag.rect.height) * streamer.canvasHeight;
      const thresholdX = (SNAP_DISTANCE_PX * streamer.canvasWidth) / drag.rect.width;
      const thresholdY = (SNAP_DISTANCE_PX * streamer.canvasHeight) / drag.rect.height;
      const targets = elements.filter((item) => item.id !== drag.id && item.visible);
      if (drag.kind === "move") {
        setSnapGuides(null);
        const position = {
          x: drag.original.x + dx,
          y: drag.original.y + dy
        };
        latestPatch = !snappingEnabled(moveEvent)
          ? position
          : snapMoveToCanvasEdges(
              { ...drag.original, ...position },
              streamer.canvasWidth,
              streamer.canvasHeight,
              thresholdX,
              thresholdY,
              targets
            );
      } else {
        const resized = resizeElement(drag.original, drag.handle ?? "se", dx, dy, moveEvent);
        const geometry =
          moveEvent.altKey ||
          !snappingEnabled(moveEvent) ||
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
                thresholdY,
                {
                  aspectRatio:
                    !moveEvent.shiftKey && (drag.handle ?? "se").length === 2
                      ? drag.original.width / drag.original.height
                      : undefined,
                  targets
                }
              );
        setSnapGuides(
          !moveEvent.altKey && geometry.width !== undefined && geometry.height !== undefined
            ? activeSnapGuides(resized, geometry, streamer.canvasWidth, streamer.canvasHeight)
            : null
        );
        const scaledCrop =
          !moveEvent.altKey && geometry.width !== undefined && geometry.height !== undefined
            ? scaleCrop(drag.original, geometry.width, geometry.height)
            : undefined;
        latestPatch = { ...geometry, ...(scaledCrop ? { props: scaledCrop } : {}) };
      }
      (onTransientUpdate ?? onUpdate)?.(drag.id, latestPatch);
    }

    function handleUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      handleMove(upEvent);
      if (latestPatch) onCommitUpdate?.(drag.id, latestPatch, drag.original);
      setSnapGuides(null);
      cleanup();
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
          <div className="stage-zoom-controls">
            <span>{Math.round(scale * 100)}%</span>
            {([null, 0.25, 0.5, 0.75, 1] as const).map((percent) => (
              <button key={percent ?? "fit"} type="button" onClick={() => setZoomPreset(percent)}>
                {percent === null ? "FIT" : `${percent * 100}%`}
              </button>
            ))}
          </div>
        )}
        <div
          className="stage-surface"
          ref={surfaceRef}
          data-stage-mode={mode}
          style={surfaceStyle}
          onPointerDown={(event) => {
            if (mode === "workspace" && event.button === 0 && !spacePressed.current) {
              onSelect?.("");
            }
          }}
        >
          {mode === "workspace" && <WorkspaceZones />}
          {mode === "workspace" && snapGuides && (
            <div className="snap-guides" aria-hidden="true">
              {Object.entries(snapGuides).map(([edge, active]) =>
                active ? <span key={edge} className={`snap-guide snap-guide-${edge}`} /> : null
              )}
            </div>
          )}
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

export function zoomAroundPointer(
  zoom: number,
  deltaY: number,
  pointerX: number,
  pointerY: number,
  surfaceCenter: { x: number; y: number },
  fitScale: number,
  stagingOffset: { x: number; y: number }
): { zoom: number; panDelta: { x: number; y: number } } {
  const next = clamp(zoom * Math.exp(-deltaY * 0.0015), 0.25, 6);
  const ratio = next / zoom;
  const scaleDelta = (next - zoom) * fitScale;
  return {
    zoom: next,
    panDelta: {
      x: (1 - ratio) * (pointerX - surfaceCenter.x) - stagingOffset.x * scaleDelta,
      y: (1 - ratio) * (pointerY - surfaceCenter.y) - stagingOffset.y * scaleDelta
    }
  };
}

export function snappingEnabled(event: Pick<PointerEvent, "ctrlKey" | "metaKey">): boolean {
  return !event.ctrlKey && !event.metaKey;
}

export function shouldStartPan(button: number, space: boolean, overControls: boolean): boolean {
  return !overControls && (button === 1 || (button === 0 && space));
}

function nearestAlignmentCorrection(
  alignments: Array<{ source: number; targets: number[] }>,
  threshold: number
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const alignment of alignments) {
    for (const target of alignment.targets) {
      const correction = target - alignment.source;
      if (Math.abs(correction) < Math.abs(nearest)) nearest = correction;
    }
  }
  return Math.abs(nearest) <= threshold ? nearest : 0;
}

function targetEdges(elements: OverlayElement[], axis: "x" | "y"): number[] {
  const size = axis === "x" ? "width" : "height";
  return elements.flatMap((item) => [item[axis], item[axis] + item[size]]);
}

export function snapMoveToCanvasEdges(
  bounds: ElementBounds,
  canvasWidth: number,
  canvasHeight: number,
  thresholdX: number,
  thresholdY: number,
  targets: OverlayElement[] = []
): Pick<ElementBounds, "x" | "y"> {
  const xEdges = [0, canvasWidth, ...targetEdges(targets, "x")];
  const yEdges = [0, canvasHeight, ...targetEdges(targets, "y")];
  return {
    x:
      bounds.x +
      nearestAlignmentCorrection(
        [
          { source: bounds.x, targets: xEdges },
          { source: bounds.x + bounds.width, targets: xEdges },
          { source: bounds.x + bounds.width / 2, targets: [canvasWidth / 2] }
        ],
        thresholdX
      ),
    y:
      bounds.y +
      nearestAlignmentCorrection(
        [
          { source: bounds.y, targets: yEdges },
          { source: bounds.y + bounds.height, targets: yEdges },
          { source: bounds.y + bounds.height / 2, targets: [canvasHeight / 2] }
        ],
        thresholdY
      )
  };
}

export function snapResizeToCanvasEdges(
  bounds: ElementBounds,
  handle: ResizeHandle,
  canvasWidth: number,
  canvasHeight: number,
  thresholdX: number,
  thresholdY: number,
  options: { aspectRatio?: number; targets?: OverlayElement[] } = {}
): ElementBounds {
  const horizontal = handle.includes("e") ? "e" : handle.includes("w") ? "w" : null;
  const vertical = handle.includes("s") ? "s" : handle.includes("n") ? "n" : null;
  const horizontalEdge = horizontal === "e" ? bounds.x + bounds.width : bounds.x;
  const verticalEdge = vertical === "s" ? bounds.y + bounds.height : bounds.y;
  const correctionX = horizontal
    ? nearestAlignmentCorrection(
        [
          {
            source: horizontalEdge,
            targets: [0, canvasWidth / 2, canvasWidth, ...targetEdges(options.targets ?? [], "x")]
          }
        ],
        thresholdX
      )
    : 0;
  const correctionY = vertical
    ? nearestAlignmentCorrection(
        [
          {
            source: verticalEdge,
            targets: [0, canvasHeight / 2, canvasHeight, ...targetEdges(options.targets ?? [], "y")]
          }
        ],
        thresholdY
      )
    : 0;
  const widthDelta = correctionX * (horizontal === "e" ? 1 : -1);
  const heightDelta = correctionY * (vertical === "s" ? 1 : -1);
  const withSize = (width: number, height: number): ElementBounds => ({
    x:
      width === bounds.width
        ? bounds.x
        : horizontal === "w"
          ? bounds.x + bounds.width - width
          : bounds.x,
    y:
      height === bounds.height
        ? bounds.y
        : vertical === "n"
          ? bounds.y + bounds.height - height
          : bounds.y,
    width,
    height
  });

  if (options.aspectRatio && horizontal && vertical) {
    const candidateX = bounds.width + widthDelta;
    const candidateY = bounds.height + heightDelta;
    const canSnapX = correctionX !== 0 && candidateX >= 8 && candidateX / options.aspectRatio >= 8;
    const canSnapY = correctionY !== 0 && candidateY >= 8 && candidateY * options.aspectRatio >= 8;
    if (
      canSnapX &&
      (!canSnapY || Math.abs(correctionX / thresholdX) <= Math.abs(correctionY / thresholdY))
    ) {
      return withSize(candidateX, candidateX / options.aspectRatio);
    }
    if (canSnapY) return withSize(candidateY * options.aspectRatio, candidateY);
    return bounds;
  }

  return withSize(
    bounds.width + widthDelta >= 8 ? bounds.width + widthDelta : bounds.width,
    bounds.height + heightDelta >= 8 ? bounds.height + heightDelta : bounds.height
  );
}

function activeSnapGuides(
  before: Partial<OverlayElement>,
  after: Partial<OverlayElement>,
  canvasWidth: number,
  canvasHeight: number
): SnapGuides | null {
  if (
    before.x === undefined ||
    before.y === undefined ||
    before.width === undefined ||
    before.height === undefined ||
    after.x === undefined ||
    after.y === undefined ||
    after.width === undefined ||
    after.height === undefined
  )
    return null;
  const changedX = before.x !== after.x || before.width !== after.width;
  const changedY = before.y !== after.y || before.height !== after.height;
  const guides = {
    left: changedX && Math.abs(after.x) < 0.000001,
    right: changedX && Math.abs(after.x + after.width - canvasWidth) < 0.000001,
    top: changedY && Math.abs(after.y) < 0.000001,
    bottom: changedY && Math.abs(after.y + after.height - canvasHeight) < 0.000001
  };
  return Object.values(guides).some(Boolean) ? guides : null;
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

  const preserveAspect = !event.shiftKey && handle.length === 2;
  const minSize = 8;
  const hasWest = handle.includes("w");
  const hasEast = handle.includes("e");
  const hasNorth = handle.includes("n");
  const hasSouth = handle.includes("s");

  const leftDelta = hasWest ? dx : 0;
  const rightDelta = hasEast ? dx : 0;
  const topDelta = hasNorth ? dy : 0;
  const bottomDelta = hasSouth ? dy : 0;

  let x = original.x + leftDelta;
  let y = original.y + topDelta;
  let width = Math.max(minSize, original.width + rightDelta - leftDelta);
  let height = Math.max(minSize, original.height + bottomDelta - topDelta);

  if (preserveAspect) {
    const ratio = original.width / Math.max(1, original.height);
    const widthChange = Math.abs(width / original.width - 1);
    const heightChange = Math.abs(height / original.height - 1);
    if (widthChange >= heightChange) {
      width = Math.max(minSize, minSize * ratio, width);
      height = width / ratio;
    } else {
      height = Math.max(minSize, minSize / ratio, height);
      width = height * ratio;
    }

    x = hasWest ? original.x + original.width - width : original.x;
    y = hasNorth ? original.y + original.height - height : original.y;
  }

  const scaledCrop = scaleCrop(original, width, height);
  return {
    x,
    y,
    width,
    height,
    ...(scaledCrop ? { props: scaledCrop } : {})
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
    cropLeft: next.left,
    cropRight: next.right,
    cropTop: next.top,
    cropBottom: next.bottom
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable=true], [role=dialog]"))
  );
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

  if (!isRenderableMediaUrl(element.src)) {
    return mode === "workspace" ? (
      <div className="media-element blocked-media" role="status">
        <strong>{element.name}</strong>
        <span>{unsafeMediaUrlMessage}</span>
      </div>
    ) : null;
  }

  if (element.type === "VIDEO" || element.type === "AUDIO") {
    const youtubeSrc = buildYouTubeEmbedUrl(element.src, {
      origin: getWindowOrigin()
    });
    if (youtubeSrc) {
      return (
        <YouTubeMedia key={youtubeSrc} element={element} mode={mode} src={youtubeSrc} />
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

  return <RetryImage key={element.src ?? ""} element={element} />;
}

function YouTubeMedia({ element, mode, src }: {
  element: OverlayElement;
  mode: CanvasStageProps["mode"];
  src: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const controllerRef = useRef<YouTubePlayerController | null>(null);
  const disposeTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    if (disposeTimerRef.current !== null) {
      window.clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }
    if (!controllerRef.current) {
      controllerRef.current = new YouTubePlayerController(frame, () => frame.dispatchEvent(new Event("youtube:status")));
    }
    return () => {
      disposeTimerRef.current = window.setTimeout(() => {
        controllerRef.current?.dispose();
        controllerRef.current = null;
        disposeTimerRef.current = null;
      }, 0);
    };
  }, [src]);
  useEffect(() => {
    controllerRef.current?.configure(
      mode === "overlay" ? element.liveVolume : element.previewVolume ?? 1,
      mode === "overlay" ? element.muted : false,
      element.loop
    );
  }, [element.liveVolume, element.previewVolume, element.muted, element.loop, mode]);
  return (
    <iframe
      ref={frameRef}
      className="media-element video-frame"
      style={buildCropStyle(element)}
      data-preview-media-id={mode === "workspace" ? element.id : undefined}
      data-overlay-media-id={mode === "overlay" ? element.id : undefined}
      src={src}
      referrerPolicy="strict-origin-when-cross-origin"
      title={element.name}
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
    />
  );
}

function RetryImage({ element }: { element: OverlayElement }) {
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    },
    []
  );

  const source = element.src ?? undefined;
  const retrySource = source && attempt > 0 ? imageRetryUrl(source, attempt) : source;

  return (
    <img
      className="media-element"
      style={buildCropStyle(element)}
      src={retrySource}
      referrerPolicy="no-referrer"
      alt={element.name}
      draggable={false}
      onError={() => {
        if (!source?.startsWith("https://") || attempt >= 3 || retryTimer.current !== null) return;
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = null;
          setAttempt((current) => current + 1);
        }, [1500, 4000, 10000][attempt]);
      }}
    />
  );
}

export function imageRetryUrl(source: string, attempt: number): string {
  if (!source.startsWith("https://") || attempt < 1) return source;
  const url = new URL(source);
  url.searchParams.set("overlayRetry", String(attempt));
  return url.toString();
}

function buildCropStyle(element: OverlayElement): CSSProperties | undefined {
  const crop = getCrop(element);
  if (crop.left === 0 && crop.right === 0 && crop.top === 0 && crop.bottom === 0) {
    return undefined;
  }
  return {
    clipPath: cropClipPath(crop, element.width, element.height)
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
