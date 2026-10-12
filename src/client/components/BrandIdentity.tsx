import { BrandMark } from "./BrandMark";

export function BrandIdentity({ className = "" }: { className?: string }) {
  return (
    <a className={`lxst-brand ${className}`} href="/" aria-label="LXST Overlay — главная">
      <span className="lxst-brand-icon">
        <BrandMark />
      </span>
      <span className="lxst-brand-name">
        LXST <span>Overlay</span>
      </span>
    </a>
  );
}
