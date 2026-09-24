import type { OverlayElement } from "../shared/types";

export function reconcilePreview(
  state: OverlayElement[],
  inFlight: ReadonlyMap<string, Partial<OverlayElement>>,
  pending: ReadonlyMap<string, Partial<OverlayElement>>
): OverlayElement[] {
  return state.map((item) => {
    const sent = inFlight.get(item.id);
    const queued = pending.get(item.id);
    return sent || queued
      ? { ...item, ...sent, ...queued, props: queued?.props ?? sent?.props ?? item.props }
      : item;
  });
}
