import { Copy, Eye, EyeOff, Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OverlayElement } from "../../shared/types";
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

interface PropertiesPanelProps {
  selected: OverlayElement | null;
  onUpdate: (id: string, patch: Partial<OverlayElement>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function PropertiesPanel({
  selected,
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
    if (!mediaElement) {
      setVideoTime({ current: 0, duration: 0 });
      return undefined;
    }
    const interval = window.setInterval(() => {
      setVideoTime({
        current: mediaElement.currentTime || 0,
        duration: Number.isFinite(mediaElement.duration) ? mediaElement.duration : 0
      });
    }, 250);
    return () => window.clearInterval(interval);
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
          selected={selected}
          mediaElement={mediaElement}
          videoTime={videoTime}
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
  mediaElement,
  videoTime,
  update
}: {
  selected: OverlayElement;
  mediaElement: PlayableNode | null;
  videoTime: { current: number; duration: number };
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
  const showHours = videoTime.duration >= 3600;

  useEffect(() => {
    setPositionText("00:00");
    setPositionError("");
    setEditingPosition(false);
    setScrubbing(false);
    scrubSecondsRef.current = 0;
    scrubbingRef.current = false;
    positionDraftRef.current = "00:00";
  }, [selected.id]);

  useEffect(() => {
    if (!editingPosition && !positionError)
      setPositionText(formatMediaPosition(videoTime.current, showHours));
  }, [editingPosition, positionError, videoTime.current, showHours]);

  function seek(seconds: number) {
    const bounded = Math.min(
      86400,
      Math.max(0, videoTime.duration > 0 ? Math.min(seconds, videoTime.duration) : seconds)
    );
    seekMediaNode(mediaElement, bounded);
    update({
      props: {
        ...selected.props,
        playbackCommand: "seek",
        seekSeconds: bounded,
        playbackCommandId: crypto.randomUUID()
      }
    });
    setPositionText(formatMediaPosition(bounded, showHours));
    positionDraftRef.current = formatMediaPosition(bounded, showHours);
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
      {mediaElement && (
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
            type="text"
            inputMode="numeric"
            placeholder={showHours ? "00:00:00" : "00:00"}
            value={positionText}
            aria-invalid={Boolean(positionError)}
            aria-describedby={positionError ? "media-position-error" : undefined}
            onFocus={() => {
              positionDraftRef.current = positionText;
              setEditingPosition(true);
            }}
            onBlur={() => setEditingPosition(false)}
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
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
