import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ChannelEmote, ChannelEmotesResponse, StreamerView } from "../../shared/types";
import { api } from "../api";

interface Props {
  streamer: StreamerView;
  onStreamerChange: (streamer: StreamerView) => void;
  onAdd: (emote: ChannelEmote) => void;
  canConfigure: boolean;
  canCreate: boolean;
  canDelete: boolean;
}

const empty: ChannelEmotesResponse = { twitch: [], sevenTv: [], custom: [], errors: {} };

export function EmotesPanel({
  streamer,
  onStreamerChange,
  onAdd,
  canConfigure,
  canCreate,
  canDelete
}: Props) {
  const [data, setData] = useState(empty);
  const [query, setQuery] = useState("");
  const [login, setLogin] = useState(streamer.twitchLogin ?? "");
  const [broadcasterId, setBroadcasterId] = useState(streamer.twitchBroadcasterId ?? "");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function reload(refresh = false) {
    setLoading(true);
    try {
      const result = await api<ChannelEmotesResponse>(
        refresh ? "/api/emotes?refresh=1" : "/api/emotes"
      );
      setData((current) => ({
        ...result,
        twitch: refresh && result.errors.twitch ? current.twitch : result.twitch,
        sevenTv: refresh && result.errors.sevenTv ? current.sevenTv : result.sevenTv
      }));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load emotes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const filtered = useMemo(() => {
    const matches = (emote: ChannelEmote) =>
      emote.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return {
      twitch: data.twitch.filter(matches),
      sevenTv: data.sevenTv.filter(matches),
      custom: data.custom.filter(matches)
    };
  }, [data, query]);

  async function saveChannel() {
    try {
      const result = await api<{ streamer: StreamerView }>("/api/streamer/twitch", {
        method: "PATCH",
        body: JSON.stringify({ login, broadcasterId: broadcasterId.trim() || undefined })
      });
      onStreamerChange(result.streamer);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save channel");
    }
  }

  async function addCustom() {
    try {
      const result = await api<{ emote: ChannelEmote }>("/api/emotes/custom", {
        method: "POST",
        body: JSON.stringify({ url, name: name || undefined })
      });
      setData((current) => ({ ...current, custom: [result.emote, ...current.custom] }));
      setUrl("");
      setName("");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add emote");
    }
  }

  async function deleteCustom(id: string) {
    try {
      await api(`/api/emotes/custom/${encodeURIComponent(id)}`, { method: "DELETE" });
      setData((current) => ({
        ...current,
        custom: current.custom.filter((item) => item.id !== id)
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete emote");
    }
  }

  function section(title: string, emotes: ChannelEmote[], error?: string) {
    return (
      <section className="emote-section" key={title}>
        <h3>
          {title} <small>{emotes.length}</small>
        </h3>
        {error && <p className="emote-status">{error}</p>}
        {!error && !emotes.length && <p className="emote-status">No emotes</p>}
        <div className="emote-grid">
          {emotes.map((emote) => (
            <div className="emote-item" key={emote.id}>
              <button
                type="button"
                title={`Add ${emote.name} to SPAWN`}
                onClick={() => onAdd(emote)}
              >
                <img src={emote.previewUrl} alt="" loading="lazy" />
                <span>{emote.name}</span>
              </button>
              {title === "CUSTOM" && canDelete && (
                <button
                  type="button"
                  className="emote-delete"
                  title={`Delete ${emote.name}`}
                  onClick={() => void deleteCustom(emote.id)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <aside className="emotes-panel">
      <div className="panel-title">
        <span>EMOTES</span>
        <button
          type="button"
          onClick={() => void reload(true)}
          disabled={loading}
          title="Refresh emotes"
          aria-label="Refresh emotes"
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search emotes..."
        aria-label="Search emotes"
      />
      <div className="emote-channel">
        <label htmlFor="twitch-login">Twitch channel</label>
        <div>
          <input
            id="twitch-login"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            placeholder="channel login"
            disabled={!canConfigure}
          />
          <button type="button" onClick={() => void saveChannel()} disabled={!canConfigure}>
            Save
          </button>
        </div>
        <input
          value={broadcasterId}
          onChange={(event) => setBroadcasterId(event.target.value)}
          placeholder="Twitch numeric ID (optional)"
          aria-label="Twitch broadcaster ID"
          disabled={!canConfigure}
        />
      </div>
      {loading && <p className="emote-status">Loading...</p>}
      {message && (
        <p className="emote-status" role="alert">
          {message}
        </p>
      )}
      {section("TWITCH", filtered.twitch, data.errors.twitch)}
      {section("7TV", filtered.sevenTv, data.errors.sevenTv)}
      {section("CUSTOM", filtered.custom)}
      {canCreate && (
        <div className="emote-custom-form">
          <strong>+ Add emote by URL</strong>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="7TV page or direct HTTPS image"
            aria-label="Emote URL"
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name (optional)"
            aria-label="Emote name"
          />
          <button type="button" onClick={() => void addCustom()} disabled={!url.trim()}>
            Add emote
          </button>
        </div>
      )}
    </aside>
  );
}
