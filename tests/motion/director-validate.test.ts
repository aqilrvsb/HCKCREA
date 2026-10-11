// Run: npx tsx --tsconfig tsconfig.json --test tests/motion/director-validate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDirectorPlan } from "../../lib/motion-director";

const input: any = { captions: true, captionStyle: "pop", captionPos: "low", language: "ms" };

test("keeps valid items, drops out-of-range cues and unknown types", () => {
  const raw = {
    hook: { text: "Cara Guna Gluvera Patch", sub: "Jangan salah guna" },
    accent: "#ec4899",
    overlays: [
      { t: "bigword", text: "TAMPAL", at: "w5", zone: "middle" },
      { t: "callout", text: "Jangan makan pula!", at: "w7", to: "w9" },
      { t: "laser", text: "nope", at: "w3" },
      { t: "chip", text: "Lepas cue", at: "w999" },
      { t: "cta", text: "Tekan beg kuning", at: "w18" },
    ],
    zooms: [{ at: "w4", to: "w6", scale: 3 }, { at: "w500" }],
    broll: [{ at: "w6", to: "w9", layout: "full", query: "gluvera patch box" }, { at: "w8", query: "" }],
    keywords: [{ i: 2, color: "brand", emoji: "🔥" }, { i: 2, color: "rainbow" }, { i: 99, color: "price" }],
    rehook: { at: "w10", text: "Tapi tunggu…" },
    cta: { at: "w18", text: "Tekan beg kuning" },
  };
  const p = validateDirectorPlan(raw, 20, 30, input, "gempak");
  assert.equal(p.hook?.text, "Cara Guna Gluvera Patch");
  assert.deepEqual(p.overlays.map((o) => o.t), ["bigword", "callout", "cta"]);
  assert.equal(p.overlays[1].zone, "top"); // callout defaults to top
  assert.equal(p.zooms.length, 1);
  assert.equal(p.zooms[0].scale, 1.25); // clamped
  assert.equal(p.broll.length, 1);
  assert.equal(p.broll[0].layout, "full");
  assert.deepEqual(p.keywords, [{ i: 2, color: "brand", emoji: "🔥" }]);
  assert.equal(p.rehook?.text, "Tapi tunggu…");
  assert.equal(p.cta?.text, "Tekan beg kuning");
});

test("short videos get no hook and no re-hook; bad accent falls back", () => {
  const p = validateDirectorPlan({ hook: { text: "Hi" }, accent: "pink", rehook: { at: "w1", text: "x" } }, 5, 4, input, "clean");
  assert.equal(p.hook, null);
  assert.equal(p.rehook, undefined);
  assert.equal(p.accent, "#FFD93B");
  assert.equal(p.mood, "chill");
});

test("client accent overrides the model", () => {
  const p = validateDirectorPlan({ accent: "#000000" }, 5, 10, { ...input, accent: "#22c55e" }, "gempak");
  assert.equal(p.accent, "#22c55e");
});
