// fetch_skill tool — universal across UGC/Cinema/Image agents.
//
// The agent calls fetch_skill({ kind, id }) when it needs deep knowledge on
// a specific scene/persona/hook/etc. The tool returns the skill body as a
// tool-result message that gets injected into the conversation context for
// the next turn.
//
// Design: lazy fetch beats baking everything into the system prompt. Tokens
// per turn drop from ~5800 (monolithic) to ~1500 (orchestrator + index) +
// ~500 per relevant skill (1-3 fetched per generation). Net: 1.5-3x faster
// with better output quality (deep narrow knowledge > shallow broad).

import type { ToolDefinition } from "@/lib/agent";
import { getSkill, listSkills, searchSkills } from "./loader";
import type { SkillKind, SkillTab } from "./types";

const ALL_KINDS: SkillKind[] = [
  // UGC
  "scene", "persona", "hook", "framework", "cta", "voice", "lock", "cultural",
  // Cinema
  "director", "camera", "era", "film-stock", "mood", "technique",
  // Image
  "photographer", "brand-style", "composite", "decision-tree",
];

// Build a tab-scoped fetch_skill tool. UGC agent only sees UGC skills, etc.
export function makeFetchSkillTool(tab: SkillTab): ToolDefinition {
  return {
    name: "fetch_skill",
    description:
      `Fetch a focused knowledge chunk from the ${tab.toUpperCase()} skill library. ` +
      `Use this BEFORE generating to load deep, narrow knowledge on the specific ` +
      `scene/persona/hook/framework/cta/voice you plan to use. ` +
      `Each skill is ~400-700 tokens of immediately-usable guidance ` +
      `(prompt fragments, dialog patterns, failure modes, sample prompts). ` +
      `The orchestrator system prompt lists every available skill id grouped by kind.`,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "The exact skill id from the skill index (e.g. 'kitchen-sambal', 'urban-hijabi-bestie', 'pain-confession'). " +
            "If you don't know the exact id, use the 'query' parameter for fuzzy search instead.",
        },
        kind: {
          type: "string",
          enum: ALL_KINDS,
          description:
            "Optional — narrow the search to a specific kind (scene/persona/hook/etc.). " +
            "Only used when 'query' is provided; ignored when 'id' is exact.",
        },
        query: {
          type: "string",
          description:
            "Fuzzy keyword search across triggers + titles. Use when you don't know the exact id. " +
            "Returns up to 5 best matches with their bodies. Examples: 'gym fitness male', 'hijabi morning', 'beg kuning urgency'.",
        },
      },
    },
    handler: async (args) => {
      // Exact-id path
      if (args.id) {
        const skill = getSkill(String(args.id));
        if (!skill) {
          // Fall back to fuzzy search using the id as query
          const matches = searchSkills(tab, String(args.id), 3);
          if (matches.length === 0) {
            return {
              ok: false,
              error: `No skill found with id '${args.id}'. Tip: check the SKILL INDEX in the system prompt for valid ids.`,
            };
          }
          const body = matches
            .map((s) => `## ${s.id} — ${s.title}\n\n${s.body}`)
            .join("\n\n---\n\n");
          return {
            ok: true,
            kind: "info",
            summary: `Skill '${args.id}' not found exactly — returning ${matches.length} fuzzy match(es):\n\n${body}`,
          };
        }
        if (skill.tab !== tab) {
          return {
            ok: false,
            error: `Skill '${skill.id}' belongs to tab '${skill.tab}', not '${tab}'. Refer the user to the correct tab.`,
          };
        }
        return {
          ok: true,
          kind: "info",
          summary: `# ${skill.title}\n\n${skill.body}`,
        };
      }

      // Query / list path
      if (args.query) {
        const matches = searchSkills(tab, String(args.query), 5);
        if (matches.length === 0) {
          return {
            ok: true,
            kind: "info",
            summary: `No skills matched query '${args.query}' in tab '${tab}'. Try the SKILL INDEX in the system prompt.`,
          };
        }
        const body = matches
          .map((s) => `## ${s.id} (${s.kind}) — ${s.title}\n\n${s.body}`)
          .join("\n\n---\n\n");
        return {
          ok: true,
          kind: "info",
          summary: `Found ${matches.length} skill(s) matching '${args.query}':\n\n${body}`,
        };
      }

      // List path — kind only, no query
      if (args.kind) {
        const list = listSkills(tab, args.kind as SkillKind);
        if (list.length === 0) {
          return {
            ok: true,
            kind: "info",
            summary: `No skills of kind '${args.kind}' in tab '${tab}'.`,
          };
        }
        const body = list
          .map((s) => `- **${s.id}** — ${s.title} (triggers: ${s.triggers.slice(0, 4).join(", ")})`)
          .join("\n");
        return {
          ok: true,
          kind: "info",
          summary: `${list.length} ${args.kind}(s) available:\n\n${body}\n\nCall fetch_skill({ id: '<id>' }) to load any one's full body.`,
        };
      }

      return {
        ok: false,
        error: "Provide one of: id (exact), query (fuzzy), or kind (list).",
      };
    },
  };
}
