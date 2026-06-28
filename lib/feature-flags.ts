// Centralised feature flags for temporary kill-switches. When a third-
// party provider goes down or a feature has a known regression, flip
// the relevant flag here and the UI + API surfaces auto-hide it. Avoids
// scattering hardcoded conditions across the codebase.

// Disabled 2026-06-28 per user direction — remove Sora 2 as a provider option
// from Dialog UGC, Auto Content, and Original Video. The flag auto-hides the
// Sora 2 chip on all three tabs (each checks SORA2_DISABLED). Existing Sora 2
// history rows still render normally.
//   (Previously re-enabled 2026-06-08 after APIPod restored the sora-2-vip
//    registry entry; outage window 2026-06-07 → 2026-06-08.)
export const SORA2_DISABLED = true;
