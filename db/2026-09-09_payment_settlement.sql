-- =============================================================================
-- CUPAI — Payment settlement rules.
--
-- 1) Online payment methods (InstaPay, wallets, bank transfers) can allow a
--    FULL payment, a PARTIAL payment, or both, with an exact amount or an
--    exact percentage. The agent must state ONLY what is recorded here.
--
-- 2) Cash on delivery is NOT a paid order. `on_delivery` marks a method whose
--    money is collected from the customer at delivery time, and every order
--    placed with such a method is stamped `payment_timing = 'on_delivery'` so
--    no part of the system (or the agent) can call it "paid".
--
-- Safe to re-run.
-- =============================================================================

alter table public.payment_methods
  add column if not exists on_delivery    boolean not null default false,
  add column if not exists payment_scope  text    not null default 'full',
  add column if not exists partial_type   text    not null default 'percent',
  add column if not exists partial_value  numeric not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_methods_scope_check') then
    alter table public.payment_methods
      add constraint payment_methods_scope_check
      check (payment_scope in ('full', 'partial', 'both'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_methods_partial_type_check') then
    alter table public.payment_methods
      add constraint payment_methods_partial_type_check
      check (partial_type in ('percent', 'amount'));
  end if;
end $$;

-- Existing cash-on-delivery methods keep their meaning.
update public.payment_methods
   set on_delivery = true
 where on_delivery = false
   and (name ilike '%استلام%' or name ilike '%cash on delivery%' or name ilike '%cod%');

-- Orders remember WHEN the money is collected.
alter table public.orders
  add column if not exists payment_timing text not null default 'prepaid';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_timing_check') then
    alter table public.orders
      add constraint orders_payment_timing_check
      check (payment_timing in ('prepaid', 'on_delivery'));
  end if;
end $$;

update public.orders o
   set payment_timing = 'on_delivery'
  from public.payment_methods pm
 where o.payment_timing = 'prepaid'
   and pm.on_delivery = true
   and o.payment_method is not null
   and lower(trim(o.payment_method)) = lower(trim(pm.name));

-- New accounts: the default cash-on-delivery method is marked as collected on
-- delivery from the start.
create or replace function public.seed_default_payment_methods(_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.payment_methods
    (user_id, name, enabled, behavior, detail_type, detail_value, instructions, sort_order, on_delivery)
  select _user_id, v.name, true, v.behavior, v.detail_type, '', '', v.sort_order, v.on_delivery
  from (values
    ('الدفع عند الاستلام', 'auto',   'none',  0, true),
    ('فودافون كاش',        'manual', 'phone', 1, false),
    ('اتصالات كاش',        'manual', 'phone', 2, false),
    ('إنستا باي',          'manual', 'text',  3, false)
  ) as v(name, behavior, detail_type, sort_order, on_delivery)
  where not exists (
    select 1 from public.payment_methods pm where pm.user_id = _user_id
  );
$$;
