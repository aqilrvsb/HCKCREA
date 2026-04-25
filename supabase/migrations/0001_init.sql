-- ============================================================================
-- PeningLab — initial schema
-- Profiles, history, batches, credit transactions
-- ============================================================================

-- Required extensions
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared trigger function — must be defined before any table that uses it
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles — extends auth.users with our app fields
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  whatsapp        text,
  credits         numeric(12,2) default 0 not null,
  plan            text default 'free' not null, -- 'free' | 'light' | 'pro'
  plan_expires_at timestamptz,
  is_admin        boolean default false not null,
  is_active       boolean default true not null,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

-- For existing tables that pre-date is_active, add it idempotently.
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles'
                 and column_name = 'is_active') then
    alter table public.profiles add column is_active boolean default true not null;
  end if;
end $$;

-- Auto-create a profile row when a user signs up.
-- The trigger reads name + whatsapp from raw_user_meta_data (set in our register flow).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, whatsapp)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'whatsapp', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- batches — one row per Auto Content run (parent of N history rows)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.batches (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  product_url         text,
  product_name        text,
  product_image_url   text,
  quantity            int default 10 not null,
  duration_mode       text default '8' not null, -- '8' | '16'
  cta_mode            text default 'shop' not null, -- 'shop' | 'custom' | 'none'
  custom_cta          text,
  avatar_gender       text, -- 'auto' | 'male' | 'female'
  avatar_hijab        text, -- 'auto' | 'hijab' | 'no-hijab'
  avatar_age          text, -- 'auto' | '20s' | '30s' | '40s'
  status              text default 'pending' not null, -- 'pending' | 'planning' | 'generating' | 'done' | 'failed'
  master_plan         jsonb,
  videos_done         int default 0 not null,
  videos_failed       int default 0 not null,
  cost                numeric(12,2) default 0 not null,
  error_message       text,
  created_at          timestamptz default now() not null,
  updated_at          timestamptz default now() not null
);

create index if not exists batches_user_idx on public.batches(user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- history — one row per generation (image / video / clone / batch-child)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.history (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  type            text not null, -- 'image' | 'video' | 'clone' | 'auto-content' | 'auto-post'
  tab             text not null, -- 'image' | 'video' | 'clone' | 'auto' | 'post'
  status          text default 'pending' not null, -- 'pending' | 'done' | 'failed'
  prompt          text,
  caption         text,
  hashtags        text[],
  output_url      text, -- generated image URL or video URL
  thumbnail_url   text,
  reference_url   text, -- input reference image / video
  duration        int, -- seconds (for video)
  task_id         text, -- RunningHub task_id for status polling
  framework       text, -- for auto-content videos (e.g. 'FOMO/Urgency')
  metadata        jsonb default '{}' not null,
  cost            numeric(12,2) default 0 not null,
  batch_id        uuid references public.batches(id) on delete cascade,
  error_message   text,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

create index if not exists history_user_tab_idx on public.history(user_id, tab, created_at desc);
create index if not exists history_batch_idx on public.history(batch_id);
create index if not exists history_task_idx on public.history(task_id) where task_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- payments — Chip purchase records (subscription + credit topup)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id                  uuid primary key default uuid_generate_v4(),
  -- user_id NULLABLE — populated after auto-register for checkout_signup type.
  user_id             uuid references auth.users(id) on delete cascade,
  type                text not null, -- 'subscription' | 'credit_topup' | 'checkout_signup'
  plan                text, -- 'light' | 'pro'
  credits             numeric(12,2), -- for credit_topup
  amount              numeric(12,2) not null,
  currency            text default 'MYR' not null,
  status              text default 'pending' not null, -- 'pending' | 'paid' | 'failed' | 'refunded'
  chip_purchase_id    text unique,
  chip_checkout_url   text,
  chip_transaction_id text,
  paid_at             timestamptz,
  metadata            jsonb default '{}' not null,
  created_at          timestamptz default now() not null,
  updated_at          timestamptz default now() not null
);

create index if not exists payments_user_idx on public.payments(user_id, created_at desc);
create index if not exists payments_chip_idx on public.payments(chip_purchase_id) where chip_purchase_id is not null;

drop trigger if exists payments_touch on public.payments;
create trigger payments_touch
  before update on public.payments
  for each row execute function public.touch_updated_at();

alter table public.payments enable row level security;

drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments
  for select using (auth.uid() = user_id);
-- inserts/updates done server-side via service role

-- ─────────────────────────────────────────────────────────────────────────────
-- credit_transactions — audit trail for kredit movements
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.credit_transactions (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  amount        numeric(12,2) not null, -- positive = top-up; negative = deduction
  balance_after numeric(12,2) not null,
  reason        text not null, -- e.g. 'image_generate', 'video_8s', 'topup_growth', 'signup_bonus'
  history_id    uuid references public.history(id) on delete set null,
  batch_id      uuid references public.batches(id) on delete set null,
  metadata      jsonb default '{}' not null,
  created_at    timestamptz default now() not null
);

create index if not exists credit_tx_user_idx on public.credit_transactions(user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at auto-touch triggers (function defined at top of file)
-- ─────────────────────────────────────────────────────────────────────────────

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists batches_touch on public.batches;
create trigger batches_touch
  before update on public.batches
  for each row execute function public.touch_updated_at();

drop trigger if exists history_touch on public.history;
create trigger history_touch
  before update on public.history
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — users can only see their own data
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.batches enable row level security;
alter table public.history enable row level security;
alter table public.credit_transactions enable row level security;

-- profiles: user sees + updates own row
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- batches: user CRUDs own rows
drop policy if exists "batches_select_own" on public.batches;
create policy "batches_select_own" on public.batches
  for select using (auth.uid() = user_id);

drop policy if exists "batches_insert_own" on public.batches;
create policy "batches_insert_own" on public.batches
  for insert with check (auth.uid() = user_id);

drop policy if exists "batches_update_own" on public.batches;
create policy "batches_update_own" on public.batches
  for update using (auth.uid() = user_id);

drop policy if exists "batches_delete_own" on public.batches;
create policy "batches_delete_own" on public.batches
  for delete using (auth.uid() = user_id);

-- history: same pattern
drop policy if exists "history_select_own" on public.history;
create policy "history_select_own" on public.history
  for select using (auth.uid() = user_id);

drop policy if exists "history_insert_own" on public.history;
create policy "history_insert_own" on public.history
  for insert with check (auth.uid() = user_id);

drop policy if exists "history_update_own" on public.history;
create policy "history_update_own" on public.history
  for update using (auth.uid() = user_id);

drop policy if exists "history_delete_own" on public.history;
create policy "history_delete_own" on public.history
  for delete using (auth.uid() = user_id);

-- credit_transactions: user sees own (writes only via service role)
drop policy if exists "credit_tx_select_own" on public.credit_transactions;
create policy "credit_tx_select_own" on public.credit_transactions
  for select using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- admin_device — WhatsApp Center instance for admin-broadcast (login info,
-- payment notifications). One row, instance is the device UUID at WhatsApp
-- Center / Whacenter.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.admin_device (
  id           uuid primary key default uuid_generate_v4(),
  instance     text not null,
  label        text default 'Default',
  active       boolean default true not null,
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null
);

drop trigger if exists admin_device_touch on public.admin_device;
create trigger admin_device_touch
  before update on public.admin_device
  for each row execute function public.touch_updated_at();

alter table public.admin_device enable row level security;

-- Read/write: admin only.
drop policy if exists "admin_device_admin_only" on public.admin_device;
create policy "admin_device_admin_only" on public.admin_device
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- app_settings — admin-managed key/value config (mirrors extension's pattern).
-- Reads happen via service role (server-side only). Edits via /admin UI.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  category    text default 'general' not null, -- 'provider' | 'pricing' | 'model' | 'plan' | 'general'
  updated_at  timestamptz default now() not null,
  updated_by  uuid references auth.users(id)
);

drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

alter table public.app_settings enable row level security;

-- Anyone authenticated can read (so client-side helpers work).
-- In production we read via service role anyway, but RLS read keeps things safe.
drop policy if exists "settings_select_authed" on public.app_settings;
create policy "settings_select_authed" on public.app_settings
  for select using (auth.role() = 'authenticated');

-- Only admins can write.
drop policy if exists "settings_write_admin" on public.app_settings;
create policy "settings_write_admin" on public.app_settings
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed default settings — only the keys we actually use (P2 + fal + OpenRouter)
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.app_settings (key, value, description, category) values
  -- ── PROVIDERS (URLs + paths only — keys must be filled via /admin or
  --     directly in this table; never commit real keys to this file) ──
  ('p2_base',           '{"url":"https://api.crun.ai"}',                                          'P2 (Crun.ai) API base URL',                       'provider'),
  ('p2_key',            '{"key":""}',                                                             'P2 (Crun.ai) API key — fill via admin',           'provider'),
  ('p2_create_path',    '{"path":"/api/v1/client/job/CreateTask"}',                               'P2 create-task endpoint',                         'provider'),
  ('p2_status_path',    '{"path":"/api/v1/client/job/TaskInfo"}',                                 'P2 task-status endpoint',                         'provider'),

  ('fal_base',          '{"url":"https://fal.run"}',                                              'fal.ai base URL (video utilities)',               'provider'),
  ('fal_key',           '{"key":""}',                                                             'fal.ai API key — fill via admin',                 'provider'),
  ('fal_merge_path',    '{"path":"/fal-ai/ffmpeg-api/merge-videos"}',                             'fal video merge endpoint',                        'provider'),
  ('fal_extract_path',  '{"path":"/fal-ai/ffmpeg-api/extract-frame"}',                            'fal frame extract endpoint',                      'provider'),
  ('fal_upscale_path',  '{"path":"/fal-ai/esrgan"}',                                              'fal image upscale endpoint',                      'provider'),

  ('or_base',           '{"url":"https://openrouter.ai/api/v1"}',                                 'OpenRouter base URL (chat models)',               'provider'),
  ('or_key',            '{"key":""}',                                                             'OpenRouter API key — fill via admin',             'provider'),

  -- ── MODELS (OpenRouter chat) ─────────────────────────────────────────────
  ('model_auto',        '{"model":"openai/gpt-5.4"}',         'Master Planner (Auto Content)',          'model'),
  ('model_clone',       '{"model":"deepseek/deepseek-v3.2"}', 'Clone segment planner',                  'model'),
  ('model_vision',      '{"model":"deepseek/deepseek-v3.2"}', 'Vision / video analysis',                'model'),
  ('model_product_ocr', '{"model":"claude-haiku-4-5"}',       'Product label OCR (cheap vision)',       'model'),
  ('model_retry',       '{"model":"claude-haiku-4-5"}',       'Retry/error recovery model',             'model'),

  -- ── MODELS (P2 video) ────────────────────────────────────────────────────
  ('p2_model_t2v',      '{"model":"google/veo3-1-fast-t2v"}', 'P2 text-to-video model',                 'model'),
  ('p2_model_i2v',      '{"model":"google/veo3-1-fast-i2v"}', 'P2 image-to-video model',                'model'),
  ('p2_model_r2v',      '{"model":"google/veo3-1-fast-r2v"}', 'P2 reference-to-video model',            'model'),

  -- ── MODELS (P2 image) ────────────────────────────────────────────────────
  ('image_models',      '{"nano-banana-pro":"google/nano-banana-pro","nano-banana-2":"google/nano-banana-2","gpt-image-2":"openai/gpt-image-2-stable"}', 'Image model registry', 'model'),
  ('image_default',     '{"model":"nano-banana-pro"}',        'Default image model',                    'model'),

  -- ── PRICING (kredit per action) ──────────────────────────────────────────
  ('credit_costs',      '{"image":0.20,"video_8s":0.40,"video_16s":0.80,"auto_plan":0.10,"clone_plan":0.05}', 'Kredit cost per action', 'pricing'),
  ('credit_topup_price','{"price":50,"currency":"MYR"}',      'Kredit top-up price',                    'pricing'),

  -- ── PLANS (admin-editable via /admin → app_settings) ────────────────────
  ('plan_light', '{"price":50,"days":30,"credits":0,"currency":"MYR","label":"Light Plan","image_rate":0.50,"video_rate":0.70,"features":["Image (Banana Pro + GPT Image 2) — 50 sen","Video Veo 3.1 — 70 sen","Unlimited Generate","Access Prompt","Access Image","Access Video"]}', 'Light Plan — base tier', 'plan'),
  ('plan_pro',   '{"price":75,"days":30,"credits":0,"currency":"MYR","label":"Pro Plan","image_rate":0.20,"video_rate":0.40,"features":["Image (Banana Pro + GPT Image 2) — 20 sen","Video Veo 3.1 — 40 sen","Unlimited Generate","Access Prompt","Access Image","Access Video","Access Auto Content","Access Clone Video","Access Story Telling","Access Group VIP"]}', 'Pro Plan — full access', 'plan'),
  ('signup_bonus', '{"credits":0}', 'Free credits on signup (subscription unlocks access, not credit balance)', 'plan')
on conflict (key) do update set value = excluded.value, description = excluded.description;
