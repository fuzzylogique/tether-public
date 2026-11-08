/**
 * `pnpm discord:compare` — before/after review of every card in #tether-preview. For each fixture
 * with a baseline payload (apps/server/.preview/baseline/<name>.json, written by cards.test.ts with
 * SNAPSHOT_DIR/SNAPSHOT_FILES from an older commit), posts the old payload verbatim, then the card as
 * the current code renders it. Fixtures with no baseline are posted once as "new".
 *
 *   pnpm discord:compare                         clear old previews, post every pair
 *   pnpm discord:compare -- approval status      only fixtures whose name contains one of the words
 *   pnpm discord:compare -- --keep               do not delete earlier preview messages
 *   pnpm discord:compare -- --baseline <dir>     read baselines from somewhere else
 */
import "../../env.js";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AttachmentBuilder, MessageFlags, TextDisplayBuilder, type APIMessageTopLevelComponent, type MessageCreateOptions } from "discord.js";
import { fixtures } from "@tether/core";
import { render } from "./render.js";
import { openPreviewChannel } from "./previewChannel.js";
import type { Snapshot } from "./cards.test.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const keep = args.includes("--keep");
const baselineFlag = args.indexOf("--baseline");
const baselineDir = resolve(baselineFlag >= 0 ? args[baselineFlag + 1] ?? "" : new URL("../../../.preview/baseline", import.meta.url).pathname);
const filters = args.filter((a, i) => !a.startsWith("--") && i !== baselineFlag + 1);
if (!existsSync(baselineDir)) throw new Error(`no baseline at ${baselineDir}; build one with SNAPSHOT_DIR=${baselineDir} UPDATE_SNAPSHOTS=1 SNAPSHOT_FILES=1 pnpm --filter @tether/server test from the old commit`);

const { client, channel, url } = await openPreviewChannel({ clear: !keep });

const header = (text: string): MessageCreateOptions => ({
  components: [new TextDisplayBuilder().setContent(text)],
  flags: MessageFlags.IsComponentsV2,
  allowedMentions: { parse: [] },
});

/** The baseline payload exactly as the old renderer produced it, with its attachments re-read from disk. */
function baselineMessage(name: string, snap: Snapshot): MessageCreateOptions {
  const files = snap.files.map((f) => {
    const path = join(baselineDir, "files", `${name}--${f.name}`);
    if (!existsSync(path)) throw new Error(`baseline attachment missing: ${path}`);
    return new AttachmentBuilder(readFileSync(path)).setName(f.name);
  });
  return { components: snap.components as APIMessageTopLevelComponent[], files, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

let pairs = 0, fresh = 0, failed = 0;
for (const f of fixtures()) {
  if (filters.length && !filters.some((w) => f.name.includes(w))) continue;
  const baselinePath = join(baselineDir, `${f.name}.json`);
  try {
    if (existsSync(baselinePath)) {
      const snap = JSON.parse(readFileSync(baselinePath, "utf8")) as Snapshot;
      await channel.send(header(`-# ⬅️ **before** · \`${f.name}\``));
      await channel.send(baselineMessage(f.name, snap));
      await channel.send(header(`-# ➡️ **after** · \`${f.name}\``));
      await channel.send(await render(f.card));
      pairs++;
      console.log(`⇄ ${f.name}`);
    } else {
      await channel.send(header(`-# ✨ **new** · \`${f.name}\``));
      await channel.send(await render(f.card));
      fresh++;
      console.log(`+ ${f.name}`);
    }
  } catch (e) {
    failed++;
    console.error(`✗ ${f.name}:`, e instanceof Error ? e.message : e, (e as { rawError?: unknown }).rawError ? JSON.stringify((e as { rawError?: unknown }).rawError) : "");
  }
}
console.log(`${pairs} before/after pairs, ${fresh} new, ${failed} failed → ${url}`);
await client.destroy();
process.exit(failed ? 1 : 0);
