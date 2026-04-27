// Skill loader — provides type-safe lookup over the skill registry.
// In-memory; no DB roundtrip. Import once, query forever.

import type { Skill, SkillKind, SkillTab, SkillIndexEntry } from "./types";
import { allSkills } from "./registry";

// id → Skill map (built lazily on first access)
let _byId: Map<string, Skill> | null = null;
function byId(): Map<string, Skill> {
  if (!_byId) {
    _byId = new Map();
    for (const s of allSkills) _byId.set(s.id, s);
  }
  return _byId;
}

export function getSkill(id: string): Skill | null {
  return byId().get(id) ?? null;
}

// Filter skills by tab and optional kind. Used by fetch_skill tool when
// agent doesn't pass an exact id (e.g. asks for "any persona").
export function listSkills(tab: SkillTab, kind?: SkillKind): Skill[] {
  return allSkills.filter((s) => s.tab === tab && (kind ? s.kind === kind : true));
}

// Search by trigger keyword — fuzzy match. Returns top N by trigger overlap.
export function searchSkills(
  tab: SkillTab,
  query: string,
  limit = 5
): Skill[] {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (q.length === 0) return [];
  const scored = allSkills
    .filter((s) => s.tab === tab)
    .map((s) => {
      const hay = [s.title.toLowerCase(), ...s.triggers.map((t) => t.toLowerCase())].join(" ");
      let score = 0;
      for (const term of q) if (hay.includes(term)) score += 1;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((x) => x.s);
}

// Compact skill index for the orchestrator system prompt — agent sees
// title + kind + triggers so it knows what's available without loading
// the full body of every skill.
export function getSkillIndex(tab: SkillTab): SkillIndexEntry[] {
  return allSkills
    .filter((s) => s.tab === tab)
    .map((s) => ({
      id: s.id,
      kind: s.kind,
      tab: s.tab,
      title: s.title,
      triggers: s.triggers,
    }));
}

// Render the skill index as a compact string the agent can read in its
// system prompt — grouped by kind, one line per skill.
export function renderSkillIndex(tab: SkillTab): string {
  const idx = getSkillIndex(tab);
  const groups = new Map<SkillKind, SkillIndexEntry[]>();
  for (const e of idx) {
    if (!groups.has(e.kind)) groups.set(e.kind, []);
    groups.get(e.kind)!.push(e);
  }
  const out: string[] = [];
  for (const [kind, entries] of groups) {
    out.push(`\n## ${kind.toUpperCase()}S`);
    for (const e of entries) {
      out.push(`- ${e.id} — ${e.title}`);
    }
  }
  return out.join("\n").trim();
}
