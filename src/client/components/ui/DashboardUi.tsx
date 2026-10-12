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
  return src ? (
    <img className="lxst-avatar" src={src} alt="" />
  ) : (
    <span className="lxst-avatar lxst-avatar-fallback" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function DashboardSection({
  id,
  eyebrow,
  title,
  children,
  className = ""
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`lxst-panel ${className}`} id={id} aria-label={title}>
      <div className="lxst-panel-heading">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
