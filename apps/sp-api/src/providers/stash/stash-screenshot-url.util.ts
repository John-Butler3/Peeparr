/**
 * Peeparr's address for a Stash scene's screenshot. Stash versions its own
 * screenshot links (`?t=...`, changing when the screenshot is regenerated)
 * and lets browsers keep them for a year, so the same version goes on the
 * end here: a new screenshot gets a new address and shows straight away.
 */
export function stashScreenshotUrl(
  sceneId: string,
  stashScreenshotPath: string | null | undefined,
): string | null {
  if (!stashScreenshotPath) {
    return null;
  }
  const base = `/api/media/stash/scenes/${encodeURIComponent(sceneId)}/screenshot`;
  const version = /[?&]t=([^&#]+)/.exec(stashScreenshotPath)?.[1];
  return version ? `${base}?v=${encodeURIComponent(decodeURIComponent(version))}` : base;
}
