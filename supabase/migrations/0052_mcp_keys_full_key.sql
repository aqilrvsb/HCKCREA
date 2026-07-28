-- Store the full plaintext MCP key so the dashboard's copy button can copy the
-- complete, working key at any time (product decision — convenience over the
-- show-once model, per platform owner). Auth still verifies against the bcrypt
-- `hash` column; `full_key` is display/copy only. Nullable: keys minted before
-- this column existed have no stored plaintext and stay prefix-only in the UI.
alter table public.user_mcp_keys
  add column if not exists full_key text;
