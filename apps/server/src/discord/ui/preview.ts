/**
 * `pnpm discord:preview` — posts one of every card, built from fixture data, into
 * #tether-preview in DISCORD_DEV_GUILD_ID. This is the acceptance tool for the UI work
 * (docs/DISCORD_UI.md §11): no Inngest, no Gemini, no database.
 *
 *   pnpm discord:preview                 clear old previews, post everything
 *   pnpm discord:preview -- plan status  only fixtures whose name contains one of the words
 *   pnpm discord:preview -- --keep       do not delete earlier preview messages
 *
 * Uses DISCORD_PREVIEW_CHANNEL_ID when set, else #tether-preview (created if the bot can).
 */
import "../../env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtures } from "@tether/core";
import { render } from "./render.js";
import { openPreviewChannel } from "./previewChannel.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const keep = args.includes("--keep");
const filters = args.filter((a) => !a.startsWith("--"));
const { client, channel, url } = await openPreviewChannel({ clear: !keep });

const outDir = join(new URL("../../..", import.meta.url).pathname, ".preview");
mkdirSync(outDir, { recursive: true });

let posted = 0, failed = 0;
for (const f of fixtures()) {
  if (filters.length && !filters.some((w) => f.name.includes(w))) continue;
  try {
    const payload = await render(f.card);
    for (const file of payload.files) {
      if (typeof file.name === "string" && Buffer.isBuffer(file.attachment)) writeFileSync(join(outDir, `${f.name}--${file.name}`), file.attachment);
    }
    await channel.send(payload);
    posted++;
    console.log(`✓ ${f.name}${payload.files.length ? ` (${payload.files.map((x) => `${x.name} ${Math.round((x.attachment as Buffer).length / 1024)}KB`).join(", ")})` : ""}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${f.name}:`, e instanceof Error ? e.message : e, (e as { rawError?: unknown }).rawError ? JSON.stringify((e as { rawError?: unknown }).rawError) : "");
  }
}
console.log(`${posted} posted, ${failed} failed → ${url}`);
await client.destroy();
process.exit(failed ? 1 : 0);
