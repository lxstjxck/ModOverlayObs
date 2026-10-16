import { Copy, Eye, EyeOff, Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OverlayElement } from "../../shared/types";
import type { MediaStatus } from "../../shared/mediaStatus";
import {
  isPlayableNode,
  seekMediaNode,
  observeYouTubeTime,
  pauseMediaNode,
  playMediaNode,
  restartMediaNode,
  setMediaNodeVolume,
  stopMediaNode,
  type PlayableNode
} from "../mediaPlayback";
import { isPlayableMedia, isText } from "../utils";
import { formatMediaPosition, parseMediaPosition } from "../mediaPosition";
import { scaleCrop } from "../cropGeometry";

interface PropertiesPanelProps {
  selected: OverlayElement | null;
  mediaStatuses: MediaStatus[];
  onUpdate: (id: string, patch: Partial<OverlayElement>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function PropertiesPanel({
  selected,
  mediaStatuses,
  onUpdate,
  onDuplicate,
  onRemove
}: PropertiesPanelProps) {
  const [videoTime, setVideoTime] = useState({ current: 0, duration: 0 });
  const [mediaElement, setMediaElement] = useState<PlayableNode | null>(null);

  useEffect(() => {
    if (!selected || !isPlayableMedia(selected)) {
      setMediaElement(null);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const node = document.querySelector(`[data-preview-media-id="${CSS.escape(selected.id)}"]`);
      setMediaElement(isPlayableNode(node) ? node : null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected?.id, selected?.type]);

  useEffect(() => {
    if (mediaElement instanceof HTMLIFrameElement) {
      setVideoTime({ current: 0, duration: 0 });
      return observeYouTubeTime(mediaElement, setVideoTime);
    }
    setVideoTime({ current: 0, duration: 0 });
    return undefined;
  }, [mediaElement]);

  if (!selected) {
    return (
      <aside className="properties-panel">
        <div className="panel-title">
          <span>Properties</span>
        </div>
        <div className="empty-list">No selection</div>
      </aside>
    );
  }

  const update = (patch: Partial<OverlayElement>) => onUpdate(selected.id, patch);

  return (
    <aside className="properties-panel">
      <div className="panel-title">
        <span>Properties</span>
      </div>

      {isText(selected) && (
        <>
          <label className="field">
            Text
            <textarea
              value={selected.text ?? ""}
              onChange={(event) => update({ text: event.target.value })}
            />
          </label>
          <TextStyleControls selected={selected} onUpdate={update} />
        </>
      )}

      <div className="grid-fields">
        <NumberField
          label="X"
          value={selected.x}
          focusTransform
          onChange={(x) => update({ x: Math.max(-10000, Math.min(10000, x)) })}
        />
        <NumberField
          label="Y"
          value={selected.y}
          onChange={(y) => update({ y: Math.max(-10000, Math.min(10000, y)) })}
        />
      </div>
      <div className="grid-fields">
        <NumberField
          label="W"
          value={selected.width}
          onChange={(value) => {
            const width = Math.max(8, Math.min(10000, value));
            const props = scaleCrop(selected, width, selected.height);
            update({
              width,
              ...(props ? { props } : {})
            });
          }}
        />
        <NumberField
          label="H"
          value={selected.height}
          onChange={(value) => {
            const height = Math.max(8, Math.min(10000, value));
            const props = scaleCrop(selected, selected.width, height);
            update({
              height,
              ...(props ? { props } : {})
            });
          }}
        />
      </div>
      <div className="grid-fields">
        <NumberField
          label="Rot"
          value={selected.rotation}
          onChange={(rotation) => update({ rotation })}
        />
        <NumberField label="Z" value={selected.zIndex} onChange={(zIndex) => update({ zIndex })} />
      </div>

      <label className="field">
        Opacity
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={selected.opacity}
          onChange={(event) => update({ opacity: Number(event.target.value) })}
        />
      </label>

      {isPlayableMedia(selected) && (
        <MediaControls
          key={selected.id}
          selected={selected}
          statuses={mediaStatuses}
          mediaElement={mediaElement}
          previewTime={videoTime}
          onSeek={(current) => setVideoTime((time) => ({ ...time, current }))}
          update={update}
        />
      )}

      <div className="action-stack">
        <button type="button" onClick={onDuplicate}>
          <Copy size={16} /> Duplicate
        </button>
        <button type="button" onClick={() => update({ visible: !selected.visible })}>
          {selected.visible ? <EyeOff size={16} /> : <Eye size={16} />}
          {selected.visible ? "Hide" : "Show"}
        </button>
        <button className="danger" type="button" onClick={onRemove}>
          <Trash2 size={16} /> Remove
        </button>
      </div>
    </aside>
  );
}

function TextStyleControls({
  selected,
  onUpdate
}: {
  selected: OverlayElement;
  onUpdate: (patch: Partial<OverlayElement>) => void;
}) {
  const props = selected.props;
  const updateProp = (key: string, value: unknown) =>
    onUpdate({ props: { ...props, [key]: value } });
  return (
    <>
      <div className="grid-fields">
        <NumberField
          label="Size"
          value={typeof props.fontSize === "number" ? props.fontSize : 46}
          onChange={(value) => updateProp("fontSize", value)}
        />
        <NumberField
          label="Weight"
          value={typeof props.fontWeight === "number" ? props.fontWeight : 800}
          onChange={(value) => updateProp("fontWeight", value)}
        />
      </div>
      <div className="grid-fields">
        <label className="field">
          Color
          <input
            type="color"
            value={typeof props.color === "string" ? props.color : "#ffffff"}
            onChange={(event) => updateProp("color", event.target.value)}
          />
        </label>
        <label className="field">
          Stroke
          <input
            type="color"
            value={typeof props.stroke === "string" ? props.stroke : "#000000"}
            onChange={(event) => updateProp("stroke", event.target.value)}
          />
        </label>
      </div>
    </>
  );
}

function MediaControls({
  selected,
  statuses,
  mediaElement,
  previewTime,
  onSeek,
  update
}: {
  selected: OverlayElement;
  statuses: MediaStatus[];
  mediaElement: PlayableNode | null;
  previewTime: { current: number; duration: number };
  onSeek: (current: number) => void;
  update: (patch: Partial<OverlayElement>) => void;
}) {
  const [positionText, setPositionText] = useState("00:00");
  const [positionError, setPositionError] = useState("");
  const [editingPosition, setEditingPosition] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubSeconds, setScrubSeconds] = useState(0);
  const scrubSecondsRef = useRef(0);
  const scrubbingRef = useRef(false);
  const positionDraftRef = useRef("00:00");
  const positionInputRef = useRef<HTMLInputElement>(null);
  const committedPositionRef = useRef(false);
  const [sourceId, setSourceId] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(timer);
  }, []);
  const sources = statuses.filter((status) => now - status.observedAt < 5000)
    .sort((a, b) => a.connectionId.localeCompare(b.connectionId));
  const selectedStatus = sources.find((item) => item.connectionId === sourceId) ?? sources[0];
  const youtubePreview = mediaElement instanceof HTMLIFrameElement;
  const videoTime = selectedStatus
    ? { current: selectedStatus.position, duration: selectedStatus.duration }
    : youtubePreview ? previewTime : { current: 0, duration: 0 };
  const showHours = videoTime.duration >= 3600;

  useEffect(() => {
    setPositionText("");
    setPositionError("");
    setEditingPosition(false);
    setScrubbing(false);
    scrubSecondsRef.current = 0;
    scrubbingRef.current = false;
    positionDraftRef.current = "";
  }, [selected.id]);

  useEffect(() => {
    if (!editingPosition && !positionError)
      setPositionText(selectedStatus || youtubePreview ? formatMediaPosition(videoTime.current, showHours) : "");
  }, [editingPosition, positionError, videoTime.current, showHours, selectedStatus, youtubePreview]);

  function seek(seconds: number) {
    const bounded = Math.min(
      86400,
      Math.max(0, videoTime.duration > 0 ? Math.min(seconds, videoTime.duration) : seconds)
    );
    seekMediaNode(mediaElement, bounded);
    onSeek(bounded);
    update({
      props: {
        ...selected.props,
        playbackCommand: "seek",
        seekSeconds: bounded,
        playbackCommandId: crypto.randomUUID()
      }
    });
    // The OBS timecode changes only after the player reports its actual position.
    setPositionError("");
  }

  function previewScrub(seconds: number) {
    scrubSecondsRef.current = seconds;
    scrubbingRef.current = true;
    setScrubSeconds(seconds);
    setScrubbing(true);
    if (mediaElement instanceof HTMLMediaElement) seekMediaNode(mediaElement, seconds);
  }

  function commitScrub() {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setScrubbing(false);
    seek(scrubSecondsRef.current);
  }

  function submitPosition() {
    const seconds = parseMediaPosition(positionDraftRef.current);
    if (seconds === null) {
      setPositionError("Формат: 00:00 или 00:00:00");
      setPositionText(positionDraftRef.current);
      return;
    }
    seek(seconds);
    setEditingPosition(false);
    committedPositionRef.current = true;
    positionInputRef.current?.blur();
  }

  function cancelPosition() {
    const current = selectedStatus || youtubePreview ? formatMediaPosition(videoTime.current, showHours) : "";
    positionDraftRef.current = current;
    setPositionText(current);
    setPositionError("");
    setEditingPosition(false);
  }
  function runCommand(command: "play" | "pause" | "stop" | "restart") {
    if (command === "play") {
      playMediaNode(mediaElement);
    } else if (command === "pause") {
      pauseMediaNode(mediaElement);
    } else if (command === "stop") {
      stopMediaNode(mediaElement);
    } else {
      restartMediaNode(mediaElement);
    }
    update({
      props: {
        ...selected.props,
        playbackCommand: command,
        playbackCommandId: `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
    });
  }

  return (
    <div className="video-controls">
      <div className="field">
        <span>{selectedStatus ? `OBS ${selectedStatus.connectionId.slice(0, 8)} · ${selectedStatus.playing ? "PLAYING" : "PAUSED"}` : youtubePreview ? "OBS OFFLINE · YouTube preview time" : "OBS OFFLINE · no telemetry"}</span>
        {sources.length > 1 && (
          <select aria-label="OBS source" value={selectedStatus.connectionId} onChange={(event) => setSourceId(event.target.value)}>
            {sources.map((source) => <option key={source.connectionId} value={source.connectionId}>OBS {source.connectionId.slice(0, 8)}</option>)}
          </select>
        )}
        {selectedStatus && typeof selected.props.playbackCommandId === "string" &&
          selectedStatus.commandId !== selected.props.playbackCommandId && <span>Awaiting OBS confirmation</span>}
      </div>
      <div className="mini-toolbar media-transport">
        <button
          type="button"
          title="Воспроизвести"
          aria-label="Воспроизвести"
          onClick={() => runCommand("play")}
        >
          <Play size={19} />
        </button>
        <button type="button" title="Пауза" aria-label="Пауза" onClick={() => runCommand("pause")}>
          <Pause size={19} />
        </button>
        <button
          type="button"
          title="Остановить"
          aria-label="Остановить"
          onClick={() => runCommand("stop")}
        >
          <Square size={19} />
        </button>
        <button
          type="button"
          title="Сначала"
          aria-label="Сначала"
          onClick={() => runCommand("restart")}
        >
          <RotateCcw size={19} />
        </button>
      </div>
      {mediaElement && (selectedStatus || youtubePreview) && (
        <div className="media-timeline">
          <div className="media-timeline-times">
            <span>
              {formatMediaPosition(scrubbing ? scrubSeconds : videoTime.current, showHours)}
            </span>
            <span>{formatMediaPosition(videoTime.duration, showHours)}</span>
          </div>
          <input
            type="range"
            aria-label="Перемотка по таймкоду"
            min={0}
            max={videoTime.duration || 1}
            step={0.01}
            disabled={videoTime.duration <= 0}
            value={Math.min(scrubbing ? scrubSeconds : videoTime.current, videoTime.duration || 1)}
            onChange={(event) => previewScrub(Number(event.target.value))}
            onPointerUp={commitScrub}
            onPointerCancel={commitScrub}
            onKeyDown={(event) => {
              const { key } = event;
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
              event.preventDefault();
              const current = scrubbingRef.current ? scrubSecondsRef.current : videoTime.current;
              const delta = event.shiftKey ? 0.1 : event.altKey ? 10 : 1;
              const next =
                key === "Home"
                  ? 0
                  : key === "End"
                    ? videoTime.duration
                    : current + (key === "ArrowRight" ? delta : -delta);
              previewScrub(Math.min(videoTime.duration, Math.max(0, next)));
            }}
            onKeyUp={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) commitScrub();
            }}
            onBlur={commitScrub}
          />
        </div>
      )}
      <form
        className="media-position-row"
        onSubmit={(event) => {
          event.preventDefault();
          submitPosition();
        }}
      >
        <label className="field">
          TIMECODE
          <input
            ref={positionInputRef}
            type="text"
            inputMode="numeric"
            placeholder={selectedStatus || youtubePreview ? showHours ? "00:00:00" : "00:00" : "OFFLINE"}
            value={positionText}
            aria-invalid={Boolean(positionError)}
            aria-describedby={positionError ? "media-position-error" : undefined}
            onFocus={() => {
              positionDraftRef.current = positionText;
              setEditingPosition(true);
            }}
            onBlur={() => {
              if (committedPositionRef.current) {
                committedPositionRef.current = false;
                return;
              }
              cancelPosition();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelPosition();
                event.currentTarget.blur();
              }
            }}
            onChange={(event) => {
              positionDraftRef.current = event.target.value;
              setPositionText(event.target.value);
              setPositionError("");
            }}
          />
        </label>
        {positionError && (
          <span className="media-position-error" id="media-position-error" role="alert">
            {positionError}
          </span>
        )}
      </form>
      <label className="field">
        Local Volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={selected.previewVolume ?? 1}
          onChange={(event) => {
            const value = Number(event.target.value);
            setMediaNodeVolume(mediaElement, value);
            update({ previewVolume: value });
          }}
        />
      </label>
      <label className="field">
        OBS Volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={selected.liveVolume}
          onChange={(event) => update({ liveVolume: Number(event.target.value) })}
        />
      </label>
      <div className="checkbox-row">
        <label>
          <input
            type="checkbox"
            checked={selected.muted}
            onChange={(event) => update({ muted: event.target.checked })}
          />
          Mute OBS
        </label>
        <label>
          <input
            type="checkbox"
            checked={selected.loop}
            onChange={(event) => update({ loop: event.target.checked })}
          />
          Loop
        </label>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  focusTransform
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  focusTransform?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        data-transform-focus={focusTransform ? "true" : undefined}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
