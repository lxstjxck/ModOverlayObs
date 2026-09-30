import { FilePlus2, Link, Music, Trash2, Type, Upload, Video } from "lucide-react";
import { useState } from "react";
import type { MediaItem, MediaType } from "../../shared/types";
import { detectMediaTypeFromUrl, getEbloPostId, getYouTubeVideoId } from "../../shared/mediaUrl";
import { formatBytes } from "../utils";

interface MediaLibraryProps {
  media: MediaItem[];
  onUpload: (files: FileList | File[]) => void;
  onAdd: (mediaId: string) => void;
  onAddUrl: (payload: { url: string; type?: MediaType; name?: string }) => Promise<boolean>;
  onDelete: (mediaIds: string[]) => void;
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
  const [urlError, setUrlError] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selected = media.filter((item) => selectedIds.has(item.id));

  function toggleSelected(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitUrl() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || addingUrl) return;
    const type = detectMediaTypeFromUrl(trimmedUrl);
    if (!type && !getEbloPostId(trimmedUrl)) {
      setUrlError(
        "Не удалось определить тип. Нужна ссылка eblo.id, YouTube или прямой URL файла с расширением."
      );
      return;
    }
    setUrlError("");
    setAddingUrl(true);
    try {
      const added = await onAddUrl({
        url: trimmedUrl,
        type: type ?? undefined,
        name: getYouTubeVideoId(trimmedUrl) ? "YouTube video" : undefined
      });
      if (added) setUrl("");
    } finally {
      setAddingUrl(false);
    }
  }

  return (
    <aside className="media-library">
      <div className="panel-title">
        <span>Media</span>
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
      <form
        className="url-tool"
        onSubmit={(event) => {
          event.preventDefault();
          void submitUrl();
        }}
      >
        <input
          type="url"
          value={url}
          placeholder="Ссылка на медиа, eblo.id или YouTube"
          aria-label="Ссылка на медиа, eblo.id или YouTube"
          aria-describedby={urlError ? "media-url-error" : undefined}
          onChange={(event) => {
            setUrl(event.target.value);
            if (urlError) setUrlError("");
          }}
          required
        />
        <button
          type="submit"
          title="Добавить по ссылке"
          aria-label="Добавить по ссылке"
          disabled={addingUrl}
        >
          <Link size={16} />
        </button>
        {urlError && (
          <p className="url-error" id="media-url-error" role="alert">
            {urlError}
          </p>
        )}
      </form>
      {canDelete && media.length > 0 && (
        <div className="media-bulk-actions">
          <label className="media-select-all">
            <input
              type="checkbox"
              checked={selected.length === media.length}
              onChange={(event) =>
                setSelectedIds(
                  event.target.checked ? new Set(media.map((item) => item.id)) : new Set()
                )
              }
            />
            Выбрать все
          </label>
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => onDelete(selected.map((item) => item.id))}
          >
            Удалить выбранные ({selected.length})
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => onDelete(media.map((item) => item.id))}
          >
            Удалить все
          </button>
        </div>
      )}
      <div className="media-list">
        {media.map((item) => (
          <div className="media-row" key={item.id}>
            <div className="media-thumb">
              <MediaThumbnail key={item.url} item={item} />
              {canDelete && (
                <input
                  className="media-select"
                  type="checkbox"
                  aria-label={`Выбрать ${item.originalName}`}
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleSelected(item.id)}
                />
              )}
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
                onClick={() => onDelete([item.id])}
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
