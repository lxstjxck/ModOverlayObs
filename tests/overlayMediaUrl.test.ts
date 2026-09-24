import { expect, it } from "vitest";
import { overlayMediaUrl } from "../src/client/overlayMediaUrl";

it("authorizes generated upload paths without leaking tokens to external URLs", () => {
  expect(overlayMediaUrl("/uploads/abc-123.mp4", "secret")).toBe(
    "/uploads/abc-123.mp4?overlayToken=secret"
  );
  for (const src of [
    "https://external.example/uploads/test.mp4",
    "//external.example/test.mp4",
    "/uploads/../../redirect",
    null,
    undefined
  ]) {
    expect(overlayMediaUrl(src, "secret")).toBe(src);
  }
});
