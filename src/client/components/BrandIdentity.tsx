import { BrandMark } from "./BrandMark";

export function BrandIdentity({
  className = "",
  product = "Overlay"
}: {
  className?: string;
  product?: string | null;
}) {
  return (
    <a className={`lxst-brand ${className}`} href="/" aria-label="LXST — главная">
      <span className="lxst-brand-icon">
        <BrandMark />
      </span>
      <span className="lxst-brand-name">LXST {product && <span>{product}</span>}</span>
    </a>
  );
}
