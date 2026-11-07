import type { ChartSpec } from "@tether/core";

/**
 * SVG → PNG. The only file that may import a rasteriser (docs/DISCORD_UI.md §6).
 * Phase 0: no rasteriser yet, so charts degrade to their alt text.
 */
export async function chartPng(_spec: ChartSpec): Promise<Buffer | undefined> {
  return undefined;
}
