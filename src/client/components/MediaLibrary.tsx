import { FilePlus2, Image, Link, Music, Trash2, Type, Upload, Video } from "lucide-react";
import { useState } from "react";
import type { MediaItem, MediaType } from "../../shared/types";
import { formatBytes } from "../utils";

interface MediaLibraryProps {
  media: MediaItem[];
  category: "ALL" | "IMAGES" | "GIF" | "VIDEOS" | "AUDIO";
  onCategoryChange: (category: "ALL" | "IMAGES" | "GIF" | "VIDEOS" | "AUDIO") => void;
  onUpload: (files: FileList | File[]) => void;
  onAdd: (mediaId: string) => void;
  onAddUrl: (payload: { url: string; type: Extract<MediaType, "VIDEO" | "AUDIO">; name?: string }) => void;
  onDelete: (mediaId: string) => void;
  onAddText: () => void;
  canDelete: boolean;
}

export function MediaLibrary({
  media,
  category,
  onCategoryChange,
  onUpload,
  onAdd,
  onAddUrl,
  onDelete,
  onAddText,
  canDelete
}: MediaLibraryProps) {
  const [url, setUrl] = useState("");
  const [urlName, setUrlName] = useState("");
  const [urlType, setUrlType] = useState<Extract<MediaType, "VIDEO" | "AUDIO">>("VIDEO");

  const filtered = media.filter((item) => {
    if (category === "ALL") {
      return true;
    }
    if (category === "IMAGES") {
      return item.type === "IMAGE";
    }
    if (category === "GIF") {
      return item.type === "GIF";
    }
    if (category === "VIDEOS") {
      return item.type === "VIDEO";
    }
    return item.type === "AUDIO";
  });

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
                onUpload(event.target.files);
                event.target.value = "";
              }
            }}
          />
        </label>
      </div>
      <div className="segmented compact">
        {(["ALL", "IMAGES", "GIF", "VIDEOS", "AUDIO"] as const).map((item) => (
          <button
            key={item}
            className={category === item ? "active" : ""}
            type="button"
            onClick={() => onCategoryChange(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <button className="text-tool" type="button" onClick={onAddText}>
        <Type size={16} />
        Text
      </button>
      <div className="url-tool">
        <div className="url-type-row">
          <select value={urlType} onChange={(event) => setUrlType(event.target.value as typeof urlType)}>
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
        {filtered.map((item) => (
          <div className="media-row" key={item.id}>
            <div className="media-thumb">
              {item.type === "VIDEO" ? (
                <Video size={18} />
              ) : item.type === "AUDIO" ? (
                <Music size={18} />
              ) : item.type === "GIF" ? (
                <span className="gif-label">GIF</span>
              ) : (
                <Image size={18} />
              )}
            </div>
            <div className="media-meta">
              <strong title={item.originalName}>{item.originalName}</strong>
              <span>
                {item.type} · {formatBytes(item.size)}
              </span>
            </div>
            <button className="icon-button" type="button" title="Add to Canvas" onClick={() => onAdd(item.id)}>
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
        {filtered.length === 0 && <div className="empty-list">No media yet</div>}
      </div>
    </aside>
  );
}
