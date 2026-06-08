// Centralised feature flags for temporary kill-switches. When a third-
// party provider goes down or a feature has a known regression, flip
// the relevant flag here and the UI + API surfaces auto-hide it. Avoids
// scattering hardcoded conditions across the codebase.

// Re-enabled 2026-06-08 after APIPod restored the sora-2-vip registry
// entry (their console banner: "The official transfer API for OpenAI
// Sora 2 is now restored"). Outage window: 2026-06-07 through
// 2026-06-08. Failed task IDs from the outage that customers should
// NOT be charged for: eab71f03-..., eb8a23bc-...
export const SORA2_DISABLED = false;
