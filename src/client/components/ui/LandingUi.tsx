import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

export function ActionLink({
  children,
  href,
  secondary = false,
  className = ""
}: {
  children: ReactNode;
  href: string;
  secondary?: boolean;
  className?: string;
}) {
  return (
    <a
      className={`landing-action ${secondary ? "landing-action-secondary" : ""} ${className}`}
      href={href}
    >
      <span>{children}</span>
      <ArrowUpRight size={19} aria-hidden="true" />
    </a>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  children,
  id
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div className="landing-section-heading">
      <p className="landing-eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      {children && <p className="landing-section-description">{children}</p>}
    </div>
  );
}

export function FeatureCard({
  icon,
  title,
  children
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="landing-feature-card">
      <div className="landing-feature-top">
        <span className="landing-feature-icon">{icon}</span>
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}
