/**
 * The /help Commands topic must list every registered subcommand with its required options
 * (docs/GUIDE.md §8), and every topic must fit Discord's limits when rendered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HELP_TOPICS, commandGroups, helpCard } from "@tether/core";
import { commandCatalog } from "./catalog.js";
import { render } from "./ui/render.js";

test("commands topic covers the registered command set", () => {
  const catalog = commandCatalog();
  const textOf = commandGroups(catalog).flatMap((g) => g.lines).join("\n");
  for (const c of catalog) {
    for (const s of c.subcommands) {
      const head = `\`/${c.name}${s.name ? ` ${s.name}` : ""}\``;
      assert.ok(textOf.includes(head), `${head} missing from the Commands topic`);
      for (const o of s.options.filter((o) => o.required)) assert.ok(textOf.includes(`**${o.name}**`), `${head} does not mark ${o.name} as required`);
    }
  }
  assert.ok(catalog.some((c) => c.name === "help"), "/help itself is registered");
});

test("every help topic renders within Discord limits", async () => {
  for (const t of HELP_TOPICS) {
    const card = helpCard(t.value, { commands: commandCatalog(), docsUrl: "https://tether.example.com/docs" });
    const payload = await render(card);
    const json = JSON.stringify(payload.components.map((c) => c.toJSON()));
    assert.ok(json.length < 12_000, `${t.value} payload is ${json.length} chars`);
    for (const b of card.blocks) if (b.kind === "text") assert.ok(b.md.length <= 4000, `${t.value} has a text block of ${b.md.length} chars`);
    const select = card.actions?.[0]?.[0];
    assert.equal(select?.kind, "select");
    if (select?.kind === "select") assert.equal(select.options.find((o) => o.default)?.value, t.value, `${t.value} is not the selected option`);
  }
});
