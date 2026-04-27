// Skill library types — small focused knowledge chunks the agent fetches
// just-in-time during conversation. Replaces the monolithic 5,800-token
// system prompt with a lean orchestrator + on-demand skill fetch.
//
// Each skill is ~300-700 tokens of dense, narrow knowledge. The agent calls
// fetch_skill({ kind, id }) and gets the markdown body injected as a tool
// result into the conversation context.

export type SkillTab = "ugc" | "cinema" | "image";

export type SkillKind =
  // UGC tab
  | "scene"
  | "persona"
  | "hook"
  | "framework"
  | "cta"
  | "voice"
  | "lock"
  | "cultural"
  // Cinema tab
  | "director"
  | "camera"
  | "era"
  | "film-stock"
  | "mood"
  | "technique"
  // Image tab
  | "photographer"
  | "brand-style"
  | "composite"
  | "decision-tree";

export type Skill = {
  id: string;
  kind: SkillKind;
  tab: SkillTab;
  title: string;
  // Keywords that signal "fetch this skill" — used by orchestrator and
  // surfaced in the SKILL_INDEX so the agent can pick relevant skills.
  triggers: string[];
  // The actual skill content — markdown, ~300-700 tokens.
  body: string;
};

export type SkillIndexEntry = {
  id: string;
  kind: SkillKind;
  tab: SkillTab;
  title: string;
  triggers: string[];
};
