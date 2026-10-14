import type { ReactNode } from "react";

export function StatusPill({
  children,
  tone = "neutral"
}: {
  children: ReactNode;
  tone?: "good" | "warning" | "danger" | "neutral";
}) {
  return (
    <span className={`lxst-status lxst-status-${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

export function ChannelAvatar({ name, src }: { name: string; src: string | null }) {
  return (
    <span className="lxst-avatar lxst-avatar-fallback" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
      {src && (
        <img
          key={src}
          className="lxst-avatar-image"
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={(event) => { event.currentTarget.hidden = true; }}
        />
      )}
    </span>
  );
}

export function DashboardSection({
  id,
  title,
  children,
  className = ""
}: {
  id?: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`lxst-panel ${className}`} id={id} aria-label={title}>
      <div className="lxst-panel-heading">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
