import { Copy, Eye, EyeOff, Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { formatClock, isPlayableMedia, isText } from "../utils";

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

      <label className="field">
        Name
        <input value={selected.name} onChange={(event) => update({ name: event.target.value })} />
      </label>

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
        <NumberField label="X" value={selected.x} onChange={(x) => update({ x })} />
        <NumberField label="Y" value={selected.y} onChange={(y) => update({ y })} />
        <NumberField label="W" value={selected.width} onChange={(width) => update({ width })} />
        <NumberField label="H" value={selected.height} onChange={(height) => update({ height })} />
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
          step={0.01}
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
  const [seekSeconds, setSeekSeconds] = useState(0);
  function seek(seconds: number) {
    seekMediaNode(mediaElement, seconds);
    update({
      props: {
        ...selected.props,
        playbackCommand: "seek",
        seekSeconds: seconds,
        playbackCommandId: crypto.randomUUID()
      }
    });
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
      <div className="mini-toolbar">
        <button type="button" title="Play" onClick={() => runCommand("play")}>
          <Play size={15} />
        </button>
        <button type="button" title="Pause" onClick={() => runCommand("pause")}>
          <Pause size={15} />
        </button>
        <button type="button" title="Stop" onClick={() => runCommand("stop")}>
          <Square size={15} />
        </button>
        <button type="button" title="Restart" onClick={() => runCommand("restart")}>
          <RotateCcw size={15} />
        </button>
      </div>
      {mediaElement && (
        <div className="timeline-row">
          <span>{formatClock(videoTime.current)}</span>
          <input
            type="range"
            min={0}
            max={videoTime.duration || 1}
            step={0.05}
            value={Math.min(videoTime.current, videoTime.duration || 1)}
            onChange={(event) => {
              seek(Number(event.target.value));
            }}
          />
          <span>{formatClock(videoTime.duration)}</span>
        </div>
      )}
      <div className="timeline-row">
        <label className="field">
          Позиция, секунды
          <input
            type="number"
            min={0}
            max={86400}
            value={seekSeconds}
            onChange={(event) =>
              setSeekSeconds(Math.max(0, Math.min(86400, Number(event.target.value))))
            }
          />
        </label>
        <button type="button" onClick={() => seek(seekSeconds)}>
          Перейти
        </button>
      </div>
      <label className="field">
        Local Volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
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
          step={0.01}
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
