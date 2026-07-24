// Scoped user-management ("Add/Edit User") — a reseller-style capability for a
// small allowlist of accounts (NOT full admin). They can create users and edit
// ONLY the users they created; they never touch credits, admin clients, or
// anyone else's accounts. Created users get a fixed premium plan.

// MANAGER accounts, grouped into TEAMS. Managers can open "Manage Users" and
// see every user tagged with their team's group (settings.managed_group).
// nl@gmail.com is the manager; nl2@gmail.com and madnl@gmail.com are USERS it
// manages (tagged managed_group="nl-team"), not managers themselves.
export const MANAGE_USERS_TEAMS: Record<string, string[]> = {
  "nl-team": ["nl@gmail.com"],
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

// Fixed plan applied to every user created through this feature.
export const MANAGED_PLAN = "premium";
export const MANAGED_PLAN_DAYS = 365;

export function managedPlanExpiry(): string {
  return new Date(Date.now() + MANAGED_PLAN_DAYS * 86_400_000).toISOString();
}
