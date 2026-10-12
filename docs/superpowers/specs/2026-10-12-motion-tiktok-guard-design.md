# Motion — "✅ Check Guideline TikTok" (TikTok guard)

Date: 2026-10-12 · Status: built

## Goal
One checkbox before the product field (Edit Video + Buat Iklan). When ticked, every Motion output
is cleaned of claims that break TikTok Shop Malaysia's 2026 content rules and Malaysian ad law —
including medical words printed on the product box, which get covered with digital "sellotape"
the way sellers physically tape their boxes before filming.

## Research basis (2026)
- TikTok Community Guidelines "2026 August" (effective 24 Sep 2026): regulated goods; bans tricks to bypass systems.
- TikTok Shop MY: Medical Misinformation (15/06/2026), Misleading Claims – Health & Beauty (14/09/2026),
  Exaggerated Claims (07/11/2025), Weight Management (25/06/2026), Prohibited & Unsupported Products
  (14/07/2026 — all medical devices "unsupported"), Circumventing Content Restrictions (08/10/2025),
  Sensational Content (22/01/2026), Misleading Price (20/05/2026); Account/Creator Health Rating 2026.
- Act 290 (Medicines (Advertisement and Sale) Act 1956): labels + spoken words are advertisements;
  20 Schedule conditions (diabetes, hypertension, cancer, kidney, heart …) cannot be advertised at all.
- LIU guideline (amended 26.8.2025): implied claims and "membantu" + disease are banned; superlatives list.
- MAB Policy 4.2026, Medical Device Act 2012 + Advertising Regulations 2019, CPA 1999, TDA 2011.

Key consequence: **remove claims, never disguise them.** Euphemisms ("gula", "sugar level") are still
the claim; muting one word leaves an implied claim — whole claim statements are cut. Some products
(patches/devices, disease products, slimming) are unsupported/prohibited whatever the edit — we warn.

## Design
| Layer | Where | What |
|---|---|---|
| Rules prompt (`GUARD_RULES`) | director + ad writer | never write risky copy; no euphemisms; brand without medical words |
| Rule safety net (`guardHits`, `guardCensorWords`) | plan / ad post-pass, /guard | statutory terms; rewrite (LLM) or drop |
| Speech pass (`kind: speech`) | Modal → /api/motion/guard, before the jump cut | claim statements CUT via the jump-cut pass; isolated words MUTED (captions taped); product risk rating |
| Printed text (`kind: video/broll/product`) | Modal OCR (RapidOCR PP-OCR ONNX, `guard_scan` fan-out @3 fps) → /guard | risky lines → tracked tape in Remotion (`TapeLayer`), baked tape on B-roll / product photos; claim posters dropped |
| Vision pick | director | no doctors, syringes, glucometers, wounds, before/after |
| Report | settle → status → job card | "N tulisan ditampal · N dipotong · N di-mute" + ⚠️ product risk |

Fail-safe: LLM down → rules still apply; OCR failure on B-roll → unchecked images dropped; >40 % of
speech is claims → mute instead of cut.

## Verification
- Unit: tests/motion/guard.test.ts (rule hits / non-hits, query strip, phrase muting).
- E2E: original Gluvera video + synthetic clip (moving "Diabetic Patch" box + spoken claim).
