/**
 * Payload snapshot for every card fixture (docs/CARDS.md §12). Renders each fixture through the real
 * Components V2 renderer and compares the JSON Discord would receive, so a change to any card's text,
 * buttons, custom ids, accent or attachments shows up as a diff in `git status` and in the test output.
 *
 *   pnpm --filter @tether/server test                         compare against __snapshots__
 *   UPDATE_SNAPSHOTS=1 pnpm --filter @tether/server test      rewrite them after an intended change
 *
 * Runs offline: no Discord login, so `:tether_*:` shortcodes render as their unicode fallbacks.
 *   SNAPSHOT_DIR=<dir>    write/read snapshots somewhere else (used to build a baseline from an old commit)
 *   SNAPSHOT_FILES=1      also write attachment bytes to <dir>/files/<fixture>--<name>
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures } from "@tether/core";
import { render, type Rendered } from "./render.js";

const dir = process.env.SNAPSHOT_DIR ?? fileURLToPath(new URL("./__snapshots__/", import.meta.url));
const update = process.env.UPDATE_SNAPSHOTS === "1";
const saveFiles = process.env.SNAPSHOT_FILES === "1";

export type Snapshot = {
  flags: number;
  allowedMentions: Rendered["allowedMentions"];
  components: unknown[];
  files: { name: string; bytes: number; sha256: string }[];
};

function bufferOf(a: Rendered["files"][number]): Buffer | undefined {
  return Buffer.isBuffer(a.attachment) ? a.attachment : undefined;
}

export function snapshot(payload: Rendered): Snapshot {
  return {
    flags: payload.flags,
    allowedMentions: payload.allowedMentions,
    components: payload.components.map((c) => c.toJSON()),
    files: payload.files.map((f) => {
      const buf = bufferOf(f);
      return { name: String(f.name), bytes: buf?.length ?? 0, sha256: buf ? createHash("sha256").update(buf).digest("hex") : "" };
    }),
  };
}

test("card payload snapshots", async () => {
  mkdirSync(dir, { recursive: true });
  if (saveFiles) mkdirSync(join(dir, "files"), { recursive: true });
  const seen = new Set<string>();
  const written: string[] = [];
  for (const f of fixtures()) {
    assert.ok(!seen.has(f.name), `duplicate fixture name ${f.name}`);
    seen.add(f.name);
    const payload = await render(f.card);
    assert.ok(payload.components.length > 0, `${f.name} rendered no components`);
    const json = `${JSON.stringify(snapshot(payload), null, 2)}\n`;
    assert.doesNotMatch(json, /\bNaN\b|\bundefined\b|\bInfinity\b/, `${f.name} contains a bad value`);
    if (saveFiles) for (const a of payload.files) { const buf = bufferOf(a); if (buf) writeFileSync(join(dir, "files", `${f.name}--${String(a.name)}`), buf); }
    const file = join(dir, `${f.name}.json`);
    if (update || !existsSync(file)) { writeFileSync(file, json); written.push(f.name); continue; }
    assert.equal(json, readFileSync(file, "utf8"), `${f.name} changed; rerun with UPDATE_SNAPSHOTS=1 if intended`);
  }
  if (written.length) console.log(`wrote ${written.length} snapshot(s): ${written.join(", ")}`);
});
