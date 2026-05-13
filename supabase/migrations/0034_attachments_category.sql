-- 0034_attachments_category.sql
-- Add category (product | avatar) + optional source_history_id link so
-- the Attachments library can:
--   1. Filter the picker by category (a UGC slot wants Avatar, a product
--      slot wants Product)
--   2. Track which history.id was "transferred to Attachments" so the
--      image-tab cards can mark themselves and revert when the user
--      deletes the attachment.

alter table public.attachments
  add column if not exists category text not null default 'product'
    check (category in ('product', 'avatar'));

alter table public.attachments
  add column if not exists source_history_id uuid
    references public.history(id) on delete set null;

create index if not exists attachments_user_category_idx
  on public.attachments (user_id, category, created_at desc);

create index if not exists attachments_source_history_idx
  on public.attachments (source_history_id)
  where source_history_id is not null;
