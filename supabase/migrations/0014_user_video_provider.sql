-- 0014 — per-user video provider override
--
-- Lets each client pick which backend their VIDEO generations route to,
-- independent of what admin set globally. Image + Cinema stay
-- admin-controlled (one place to tune the cheaper / more reliable
-- provider for those classes).
--
-- The column is nullable: NULL = "use whatever admin set in
-- gen_provider_video". Only "p1" and "p2" are accepted; anything else
-- falls through to the admin default at runtime.

alter table public.profiles
  add column if not exists video_provider text;

alter table public.profiles
  drop constraint if exists profiles_video_provider_check;

alter table public.profiles
  add constraint profiles_video_provider_check
  check (video_provider is null or video_provider in ('p1', 'p2'));
