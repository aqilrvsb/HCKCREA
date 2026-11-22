// Clients only ever see "P10" — never the upstream video provider's brand (owner 2026-11-22).
// Safe for client components (no server imports). Used by lib/p10.ts for every error it returns
// and by the History cards for rows saved before the rename.
export const hideBrand = (s: string | null | undefined) =>
  String(s || "").replace(/(https?:\/\/)?(www\.|api\.)?to\s?apis(\.com)?(\/\S*)?/gi, "P10");
