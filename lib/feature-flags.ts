// Centralised feature flags for temporary kill-switches. When a third-
// party provider goes down or a feature has a known regression, flip
// the relevant flag here and the UI + API surfaces auto-hide it. Avoids
// scattering hardcoded conditions across the codebase.

// APIPod's sora-2-vip model is currently broken at their worker level —
// every submission returns [SY_ERR] The model 'sora2' does not exist
// despite our request body correctly using model="sora-2-vip". See
// failed task IDs eab71f03-... and eb8a23bc-... (2026-06-08). Flip
// this to false once APIPod confirms the registry entry is restored.
export const SORA2_DISABLED = true;
