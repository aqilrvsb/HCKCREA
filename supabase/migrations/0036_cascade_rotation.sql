-- 0036 — admin-configurable slot rotation for the cascade.
--
-- Replaces the hardcoded provider chains in lib/image-cascade.ts and
-- lib/video-cascade.ts with 3-slot configurations per asset class:
--
--   video_cascade_slots = { slots: ["p2-a", "p2-b", "p5"] }
--   image_cascade_slots = { slots: ["p4", "p5", "p2-a"] }
--
-- Every task picks a starting slot via round-robin (system-wide counter,
-- per asset) then walks all 3 slots cyclically until one succeeds.
-- Counters live in two Postgres sequences (atomic by design — survives
-- thousands of concurrent calls without race conditions).
--
-- p5 = APIMart (new). Different vendor than p2 (Crun) + p4 (Grsai), so
-- the cascade can survive a Crun-platform-wide or Grsai-platform-wide
-- outage by routing to p5.

-- Round-robin counters. Sequences are atomic and survive across
-- replicas. Reset by `ALTER SEQUENCE <name> RESTART WITH 1;`.
create sequence if not exists public.video_cascade_rotation start with 1;
create sequence if not exists public.image_cascade_rotation start with 1;

-- Atomic next-slot RPC. Called from lib/cascade-rotation.ts on every
-- task submit. Returns the new sequence value; the lib code converts to
-- 0-indexed slot via (value - 1) mod 3.
create or replace function public.next_cascade_slot(asset_name text)
returns bigint
language plpgsql
security definer
as $$
declare
  result bigint;
begin
  if asset_name = 'video' then
    select nextval('public.video_cascade_rotation') into result;
  elsif asset_name = 'image' then
    select nextval('public.image_cascade_rotation') into result;
  else
    result := 1;
  end if;
  return result;
end;
$$;

-- Grant execute to authenticated users + service role. Anon shouldn't
-- need it (cascade is server-side only).
grant execute on function public.next_cascade_slot(text) to service_role;
grant execute on function public.next_cascade_slot(text) to authenticated;

-- Seed default slot configurations + APIMart key.
--
-- Defaults match the cascade behavior the user was running pre-rotation:
--   video: p2-A → p2-B → p5 (third tier filled in by APIMart for
--                            cross-vendor resilience)
--   image: p4 → p5 → p2-A (cheap-first, then platform-diverse fallback)
--
-- Admin can change these at any time in /admin/settings via the slot
-- dropdowns shipped with this migration.
insert into public.app_settings (key, value, description, category)
values
  ('p5_key',
    '{"key":""}'::jsonb,
    'APIMart API key. Used by lib/p5.ts (image + video provider). Paste the sk-... key in /admin/settings.',
    'provider'),
  ('p5_image_default',
    '{"model":"gemini-3-pro-image-preview"}'::jsonb,
    'Default APIMart image model. gemini-3-pro-image-preview = Nano Banana Pro.',
    'provider'),
  ('p5_video_default',
    '{"model":"veo3.1-fast"}'::jsonb,
    'Default APIMart video model. veo3.1-fast is the cheapest gen at $0.08/call.',
    'provider'),
  ('video_cascade_slots',
    '{"slots":["p2-a","p2-b","p5"]}'::jsonb,
    'Round-robin slot config for video cascade. 3 slots, walk wraps from start. Each slot: p1 / p2-a / p2-b / p5.',
    'provider'),
  ('image_cascade_slots',
    '{"slots":["p4","p5","p2-a"]}'::jsonb,
    'Round-robin slot config for image cascade. 3 slots, walk wraps from start. Each slot: p1 / p2-a / p2-b / p4 / p5.',
    'provider')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      category = excluded.category;
