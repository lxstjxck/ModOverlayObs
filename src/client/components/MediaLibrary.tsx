import { FilePlus2, Link, Music, Trash2, Type, Upload, Video } from "lucide-react";
import { useState } from "react";
import type { MediaItem, MediaType } from "../../shared/types";
import { getYouTubeVideoId } from "../../shared/mediaUrl";
import { formatBytes } from "../utils";

interface MediaLibraryProps {
  media: MediaItem[];
  onUpload: (files: FileList | File[]) => void;
  onAdd: (mediaId: string) => void;
  onAddUrl: (payload: { url: string; type: MediaType; name?: string }) => void;
  onDelete: (mediaId: string) => void;
  onAddText: () => void;
  canDelete: boolean;
}

export function MediaLibrary({
  media,
  onUpload,
  onAdd,
  onAddUrl,
  onDelete,
  onAddText,
  canDelete
}: MediaLibraryProps) {
  const [url, setUrl] = useState("");
  const [urlName, setUrlName] = useState("");
  const [urlType, setUrlType] = useState<MediaType>("VIDEO");

  function submitUrl() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return;
    }
    onAddUrl({ url: trimmedUrl, type: urlType, name: urlName.trim() || undefined });
    setUrl("");
    setUrlName("");
  }

  return (
    <aside className="media-library">
      <div className="panel-title">
        <span>Media</span>
        <label className="icon-button" title="Upload media">
          <Upload size={17} />
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg"
            onChange={(event) => {
              if (event.target.files) {
                onUpload(Array.from(event.target.files));
                event.target.value = "";
              }
            }}
          />
        </label>
      </div>
      <label
        className="media-drop-zone"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onUpload(Array.from(event.dataTransfer.files));
        }}
      >
        <Upload size={24} />
        <span>Перетащите файлы сюда или нажмите для выбора</span>
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg"
          onChange={(event) => {
            if (event.target.files) onUpload(Array.from(event.target.files));
            event.target.value = "";
          }}
        />
      </label>
      <button className="text-tool" type="button" onClick={onAddText}>
        <Type size={16} />
        Text
      </button>
      <div className="url-tool">
        <div className="url-type-row">
          <select
            value={urlType}
            onChange={(event) => setUrlType(event.target.value as typeof urlType)}
          >
            <option value="IMAGE">Image URL</option>
            <option value="GIF">GIF URL</option>
            <option value="VIDEO">Video URL</option>
            <option value="AUDIO">Music URL</option>
          </select>
          <button type="button" title="Add URL media" onClick={submitUrl}>
            <Link size={15} />
          </button>
        </div>
        <input
          value={url}
          placeholder="https://..."
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              submitUrl();
            }
          }}
        />
        <input
          value={urlName}
          placeholder="Name"
          onChange={(event) => setUrlName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              submitUrl();
            }
          }}
        />
      </div>
      <div className="media-list">
        {media.map((item) => (
          <div className="media-row" key={item.id}>
            <div className="media-thumb">
              <MediaThumbnail key={item.url} item={item} />
            </div>
            <div className="media-meta">
              <strong title={item.originalName}>{item.originalName}</strong>
              <span>
                {item.type} · {formatBytes(item.size)}
              </span>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Add to Canvas"
              onClick={() => onAdd(item.id)}
            >
              <FilePlus2 size={16} />
            </button>
            {canDelete && (
              <button
                className="icon-button danger"
                type="button"
                title="Delete media"
                onClick={() => onDelete(item.id)}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
        {media.length === 0 && <div className="empty-list">No media yet</div>}
      </div>
    </aside>
  );
}

function MediaThumbnail({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false);
  const youtubeId = getYouTubeVideoId(item.url);
  if (failed) return item.type === "AUDIO" ? <Music size={18} /> : <Video size={18} />;
  if (item.type === "IMAGE" || item.type === "GIF" || youtubeId) {
    return (
      <img
        src={youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : item.url}
        alt={item.originalName}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  if (item.type === "VIDEO")
    return (
      <video src={item.url} muted playsInline preload="metadata" onError={() => setFailed(true)} />
    );
  return <Music size={18} />;
}
