-- Mana personal finance data model for the existing Supabase project.
-- Uses a distinct "mana_" namespace and never modifies the education app's tables.
-- Schema has been deployed to project efibfevyiepkwpnobaro.
create table if not exists public.mana_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name varchar(50) not null check (length(btrim(name)) between 1 and 50),
  number varchar(16) not null check (number ~ '^[0-9]{16}$'),
  opening_balance bigint not null default 0 check (opening_balance >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, number),
  unique (id, user_id)
);
create table if not exists public.mana_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null,
  type text not null check (type in ('deposit','pos','online','transfer')),
  amount bigint not null check (amount > 0),
  date text not null check (date ~ '^[0-9]{4}/[0-9]{2}/[0-9]{2}$'),
  time text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details)='object' and length(details::text)<=5000),
  created_at timestamptz not null default now(),
  foreign key(card_id, user_id) references public.mana_cards(id,user_id) on delete cascade
);
create index if not exists mana_cards_user_idx on public.mana_cards (user_id);
create index if not exists mana_transactions_owner_card_idx
  on public.mana_transactions (user_id,card_id,created_at desc);

alter table public.mana_cards enable row level security;
alter table public.mana_transactions enable row level security;
revoke all on public.mana_cards from public, anon;
revoke all on public.mana_transactions from public, anon;
grant select,insert,update,delete on public.mana_cards to authenticated;
grant select,insert,update,delete on public.mana_transactions to authenticated;

drop policy if exists mana_cards_select on public.mana_cards;
drop policy if exists mana_cards_insert on public.mana_cards;
drop policy if exists mana_cards_update on public.mana_cards;
drop policy if exists mana_cards_delete on public.mana_cards;
drop policy if exists mana_transactions_select on public.mana_transactions;
drop policy if exists mana_transactions_insert on public.mana_transactions;
drop policy if exists mana_transactions_update on public.mana_transactions;
drop policy if exists mana_transactions_delete on public.mana_transactions;

create policy mana_cards_select on public.mana_cards for select to authenticated
using ((select auth.uid())=user_id);
create policy mana_cards_insert on public.mana_cards for insert to authenticated
with check ((select auth.uid())=user_id);
create policy mana_cards_update on public.mana_cards for update to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy mana_cards_delete on public.mana_cards for delete to authenticated
using ((select auth.uid())=user_id);
create policy mana_transactions_select on public.mana_transactions for select to authenticated
using ((select auth.uid())=user_id);
create policy mana_transactions_insert on public.mana_transactions for insert to authenticated
with check ((select auth.uid())=user_id);
create policy mana_transactions_update on public.mana_transactions for update to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy mana_transactions_delete on public.mana_transactions for delete to authenticated
using ((select auth.uid())=user_id);
