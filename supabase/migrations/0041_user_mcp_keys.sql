-- 0041 — Per-user MCP API keys
--
-- Replaces the single shared app_settings.mcp_api_key (V1 design) with
-- per-user keys. Each user can mint multiple keys via /settings/mcp,
-- name them, and revoke individually. All MCP-triggered generations
-- bill to whichever user owns the key.

create table public.user_mcp_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  hash         text not null,
  prefix       text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index user_mcp_keys_user_id_idx on public.user_mcp_keys(user_id);
create unique index user_mcp_keys_prefix_uniq on public.user_mcp_keys(prefix);

alter table public.user_mcp_keys enable row level security;

create policy "Users read own keys"
  on public.user_mcp_keys for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users insert own keys"
  on public.user_mcp_keys for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users update own keys"
  on public.user_mcp_keys for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own keys"
  on public.user_mcp_keys for delete
  to authenticated
  using (auth.uid() = user_id);

-- Migrate the V1 single shared key (if it exists) to a per-user row
-- owned by the admin who created it. Keeps the existing key working
-- so the user doesn't lose continuity. Then drop the legacy row.
insert into public.user_mcp_keys (user_id, name, hash, prefix, created_at, last_used_at)
select
  (value->>'owner_user_id')::uuid,
  'Migrated admin key (V1)',
  value->>'hash',
  value->>'prefix',
  coalesce((value->>'created_at')::timestamptz, now()),
  nullif(value->>'last_used_at', '')::timestamptz
from public.app_settings
where key = 'mcp_api_key'
  and value->>'owner_user_id' is not null
  and value->>'hash' is not null
  and value->>'prefix' is not null
on conflict do nothing;

delete from public.app_settings where key = 'mcp_api_key';
