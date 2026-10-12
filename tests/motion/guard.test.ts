import { test } from "node:test";
import assert from "node:assert/strict";
import { guardCensorWords, guardHits, guardStripQuery } from "@/lib/motion-guard";

test("guardHits flags Act 290 diseases, medical claims, euphemisms, absolutes, weight", () => {
  for (const s of [
    "Gluvera Diabetic Patch", "Sesuai untuk pesakit kencing manis", "Kawal gula darah", "ANTI-BLOOD SUGAR",
    "Pengawalan Gula Darah", "sugar level turun", "Boleh sembuhkan", "100% berkesan", "No.1 di Malaysia",
    "Terbaik!", "Doctor Recommended", "Turun 5kg dalam 7 hari", "Ozempic semulajadi", "Supports pancreatic health",
    "Tiada kesan sampingan", "darah tinggi", "Lulus KKM",
  ]) assert.ok(guardHits(s).length > 0, `should flag: ${s}`);
});

test("guardHits leaves neutral selling copy alone", () => {
  for (const s of [
    "Gluvera Patch", "Tampal je", "Cara guna senang", "Tekan beg kuning", "Pakai 8-12 jam", "Jangan makan",
    "Bahu / perut", "RM39 je", "Made in Korea", "Health check kejap", "Selesa dipakai", "Free shipping",
  ]) assert.deepEqual(guardHits(s), [], `should not flag: ${s}`);
});

test("guardStripQuery removes medical words from B-roll searches", () => {
  assert.equal(guardStripQuery("Gluvera diabetic patch box"), "Gluvera patch box");
  assert.equal(guardStripQuery("patch kawal gula darah"), "patch");
});

test("guardCensorWords mutes single words and two-word phrases", () => {
  const words = ["Patch", "ni", "untuk", "kencing", "manis", "dan", "gula", "darah", "Gluvera", "Diabetic", "Patch"].map((w, i) => ({ i, w }));
  assert.deepEqual(guardCensorWords(words), [3, 4, 6, 7, 9]);
  assert.deepEqual(guardCensorWords([{ i: 0, w: "manis" }, { i: 1, w: "gula" }]), []);
});

test("caption tidy: Whisper's glued hyphen goes, real hyphenated words stay", async () => {
  const { tidyToken } = await import("@/lib/motion-captions");
  assert.equal(tidyToken("-satu"), "satu");
  assert.equal(tidyToken("-cepat."), "cepat.");
  assert.equal(tidyToken("bahan-bahan"), "bahan-bahan");
  assert.equal(tidyToken("-"), "-");
});
