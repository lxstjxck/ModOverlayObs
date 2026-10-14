/** Shared LX mark asset, also used by the browser favicon. */
const brandMarkSrc = "/favicon.svg";

export function BrandMark() {
  return <img src={brandMarkSrc} alt="" aria-hidden="true" />;
}
