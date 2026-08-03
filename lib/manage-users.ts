// Scoped user-management ("Add/Edit User") — a reseller-style capability for a
// small allowlist of accounts (NOT full admin). They can create users and edit
// ONLY the users they created; they never touch credits, admin clients, or
// anyone else's accounts. Created users get a fixed premium plan.

// MANAGER accounts, grouped into TEAMS. Managers can open "Manage Users" and
// see every user tagged with their team's group (settings.managed_group).
// nl@gmail.com is the manager; nl2@gmail.com and madnl@gmail.com are USERS it
// manages (tagged managed_group="nl-team"), not managers themselves.
//
// hqnl-team is a PARTNER team (see lib/partners.ts) — a superset of a plain
// reseller: on top of creating 1-year billing-less clients, HQNL also controls
// its clients' visible tabs + per-model pricing (floored at the admin base).
export const MANAGE_USERS_TEAMS: Record<string, string[]> = {
  "nl-team": ["nl@gmail.com"],
  "hqnl-team": ["hqnl@gmail.com"],
};

const norm = (e?: string | null) => String(e || "").trim().toLowerCase();

export const MANAGE_USERS_EMAILS = Object.values(MANAGE_USERS_TEAMS).flat();

export function canManageUsers(email?: string | null): boolean {
  return MANAGE_USERS_EMAILS.includes(norm(email));
}

/** The shared-list group id for a manager email (null if not a manager). */
export function manageUsersGroup(email?: string | null): string | null {
  const e = norm(email);
  for (const [group, emails] of Object.entries(MANAGE_USERS_TEAMS)) {
    if (emails.includes(e)) return group;
  }
  return null;
}

/** True if the user belongs to a Manage-Users TEAM — either a MANAGER
 *  (e.g. nl@gmail.com) or a USER it created (profiles.settings.managed_group
 *  set to a known team like "nl-team"). Used to HIDE the subscription/Billing
 *  nav from reseller teams: their users are provisioned centrally (premium 1yr),
 *  they never self-subscribe. */
export function isManagedTeamMember(email?: string | null, managedGroup?: string | null): boolean {
  if (canManageUsers(email)) return true;
  const g = String(managedGroup || "").trim();
  return g.length > 0 && Object.prototype.hasOwnProperty.call(MANAGE_USERS_TEAMS, g);
}

// Fixed plan applied to every user created through this feature.
export const MANAGED_PLAN = "premium";
export const MANAGED_PLAN_DAYS = 365;

export function managedPlanExpiry(): string {
  return new Date(Date.now() + MANAGED_PLAN_DAYS * 86_400_000).toISOString();
}
