-- =====================================================================
-- Arco Estoque — schema do Supabase (plano gratuito)
-- Cole este arquivo inteiro em: Supabase → SQL Editor → New query → Run
-- Pode rodar de novo a qualquer momento (idempotente).
--
-- Segurança aplicada AQUI, no banco (não dá para burlar pelo navegador):
--   • só usuários logados e ATIVOS acessam qualquer dado (RLS)
--   • MFA (app autenticador) exigido pelo banco quando require_mfa = true
--   • permissões por perfil: admin, gestor, operador, leitura
--   • movimentações imutáveis (sem UPDATE), saldo mantido só por trigger
--   • log de auditoria imutável de tudo que muda
-- =====================================================================

create extension if not exists "pgcrypto";

-- =========================== PERFIS / CONFIG ===========================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null default '',
  name       text not null default '',
  role       text not null default 'leitura' check (role in ('admin','gestor','operador','leitura')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id           int primary key default 1 check (id = 1),
  require_mfa  boolean not null default true,
  idle_minutes int not null default 30 check (idle_minutes between 5 and 480)
);
insert into public.app_settings (id) values (1) on conflict do nothing;

-- Novo usuário (criado no painel do Supabase) ganha um perfil.
-- O PRIMEIRO usuário vira admin; os demais entram como "leitura" até o admin promover.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, role)
  values (new.id, coalesce(new.email, ''),
          case when not exists (select 1 from profiles where role = 'admin') then 'admin' else 'leitura' end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- perfis para usuários que já existiam antes deste script
insert into public.profiles (id, email, role)
select u.id, coalesce(u.email, ''),
       case when row_number() over (order by u.created_at) = 1
                 and not exists (select 1 from public.profiles where role = 'admin')
            then 'admin' else 'leitura' end
from auth.users u
on conflict (id) do nothing;

-- ============================== HELPERS ===============================
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

-- Sessão com 2º fator (aal2), ou MFA não obrigatório
create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not coalesce((select require_mfa from app_settings where id = 1), true)
$$;

create or replace function public.can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and public.app_role() is not null
$$;

-- finance = ver valores/relatórios · scan = bipar/movimentar · manage = cadastros · admin = tudo
create or replace function public.has_cap(cap text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and case public.app_role()
    when 'admin'    then true
    when 'gestor'   then cap in ('finance','scan','manage')
    when 'operador' then cap in ('scan')
    when 'leitura'  then cap in ('finance')
    else false end
$$;

-- =============================== TABELAS ===============================
create table if not exists public.stores (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  channel        text not null default 'Outro',
  color          text not null default '#6366f1',
  active         boolean not null default true,
  commission_pct numeric(6,2) not null default 0,
  fixed_fee      numeric(10,2) not null default 0,
  monthly_goal   numeric(12,2) not null default 0,
  upseller_id    text,
  created_at     timestamptz not null default now()
);
alter table public.stores add column if not exists commission_pct numeric(6,2) not null default 0;
alter table public.stores add column if not exists fixed_fee numeric(10,2) not null default 0;
alter table public.stores add column if not exists monthly_goal numeric(12,2) not null default 0;
create unique index if not exists stores_name_key on public.stores (lower(name));

create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  document       text not null default '',
  contact        text not null default '',
  phone          text not null default '',
  email          text not null default '',
  lead_time_days integer not null default 0,
  notes          text not null default '',
  created_at     timestamptz not null default now()
);

create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  sku            text not null,
  ean            text,
  name           text not null,
  category       text not null default '',
  brand          text not null default '',
  cost           numeric(12,2) not null default 0,
  price          numeric(12,2) not null default 0,
  min_stock      integer not null default 0,
  location       text not null default '',
  stock          integer not null default 0,   -- mantido pelo trigger das movimentações
  image_url      text not null default '',
  active         boolean not null default true,
  upseller_id    text,
  supplier_id    uuid references public.suppliers(id) on delete set null,
  lead_time_days integer not null default 0,
  is_kit         boolean not null default false,
  kit_items      jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.products add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.products add column if not exists lead_time_days integer not null default 0;
alter table public.products add column if not exists is_kit boolean not null default false;
alter table public.products add column if not exists kit_items jsonb not null default '[]'::jsonb;
create unique index if not exists products_sku_key on public.products (lower(sku));
create unique index if not exists products_ean_key on public.products (ean) where ean is not null and ean <> '';

create table if not exists public.movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  type          text not null check (type in ('entrada','saida','venda','devolucao','ajuste')),
  qty           integer not null,
  unit_price    numeric(12,2),
  unit_cost     numeric(12,2),
  store_id      uuid references public.stores(id) on delete set null,
  ref           text not null default '',
  note          text not null default '',
  source        text not null default 'manual',
  affects_stock boolean not null default true,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists movements_product_idx on public.movements (product_id);
create index if not exists movements_created_idx on public.movements (created_at);
create index if not exists movements_ref_idx on public.movements (ref) where ref <> '';

create table if not exists public.purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  number      text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status      text not null default 'rascunho' check (status in ('rascunho','enviado','parcial','recebido','cancelado')),
  items       jsonb not null default '[]'::jsonb,
  expected_at date,
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists purchase_orders_number_key on public.purchase_orders (number);

create table if not exists public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running',
  message     text not null default '',
  stats       jsonb not null default '{}'::jsonb
);

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid default auth.uid(),
  actor_email text,
  action      text not null,
  table_name  text not null,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

-- ============================ REGRAS (TRIGGERS) ============================

-- Saldo + custo médio ponderado: cada movimentação atualiza o produto
create or replace function public.apply_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.affects_stock then
      update products set
        cost = case
                 when new.type = 'entrada' and new.qty > 0 and new.unit_cost is not null and new.unit_cost >= 0
                 then round((greatest(stock, 0) * cost + new.qty * new.unit_cost) / (greatest(stock, 0) + new.qty), 2)
                 else cost end,
        stock = stock + new.qty,
        updated_at = now()
      where id = new.product_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.affects_stock then
      update products set stock = stock - old.qty, updated_at = now() where id = old.product_id;
    end if;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists movements_apply on public.movements;
create trigger movements_apply after insert or delete on public.movements
  for each row execute function public.apply_movement();

-- Ninguém altera o saldo direto, só via movimentação
create or replace function public.protect_stock() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() = 1 and new.stock is distinct from old.stock then
    new.stock := old.stock;
  end if;
  return new;
end $$;

drop trigger if exists products_protect_stock on public.products;
create trigger products_protect_stock before update on public.products
  for each row execute function public.protect_stock();

-- Nunca ficar sem administrador; e-mail do perfil não é editável
create or replace function public.protect_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := old.email;
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'Não é possível remover o último administrador ativo.';
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profiles();

-- Auditoria: registra quem fez o quê (ignora efeitos colaterais de outros triggers)
create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  insert into audit_log (actor, actor_email, action, table_name, record_id, old_data, new_data)
  values (auth.uid(),
          (select email from profiles where id = auth.uid()),
          lower(tg_op), tg_table_name, rec ->> 'id',
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['products','stores','suppliers','purchase_orders','profiles','app_settings'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit()', t);
  end loop;
end $$;
-- movimentações já são a própria trilha (com created_by); auditamos só exclusões
drop trigger if exists audit_movements on public.movements;
create trigger audit_movements after delete on public.movements
  for each row execute function public.audit();

-- ================================ RLS ================================
alter table public.profiles        enable row level security;
alter table public.app_settings    enable row level security;
alter table public.stores          enable row level security;
alter table public.suppliers       enable row level security;
alter table public.products        enable row level security;
alter table public.movements       enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.sync_runs       enable row level security;
alter table public.audit_log       enable row level security;

-- visitantes sem login não têm acesso a nada
revoke all on all tables in schema public from anon;

-- remove políticas antigas para recriar
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- perfis: cada um vê o próprio; admin vê e edita todos
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_cap('admin'));
create policy profiles_update on public.profiles for update to authenticated
  using (public.has_cap('admin')) with check (public.has_cap('admin'));

-- configurações: leitura para logados (o app precisa saber se MFA é obrigatório); edição só admin
create policy settings_select on public.app_settings for select to authenticated using (true);
create policy settings_update on public.app_settings for update to authenticated
  using (public.has_cap('admin')) with check (public.has_cap('admin'));

-- cadastros: todos os perfis ativos leem; gestor/admin escrevem; só admin exclui
do $$
declare t text;
begin
  foreach t in array array['stores','suppliers','products'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.can_read())', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.has_cap(''manage''))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.has_cap(''manage'')) with check (public.has_cap(''manage''))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.has_cap(''admin''))', t);
  end loop;
end $$;

-- movimentações: imutáveis. Operador/gestor/admin lançam; só admin exclui (limpeza/restauração)
create policy movements_select on public.movements for select to authenticated using (public.can_read());
create policy movements_insert on public.movements for insert to authenticated with check (public.has_cap('scan'));
create policy movements_delete on public.movements for delete to authenticated using (public.has_cap('admin'));

-- compras: gestor cria; operador pode atualizar (recebimento); gestor exclui
create policy po_select on public.purchase_orders for select to authenticated using (public.can_read());
create policy po_insert on public.purchase_orders for insert to authenticated with check (public.has_cap('manage'));
create policy po_update on public.purchase_orders for update to authenticated using (public.has_cap('scan')) with check (public.has_cap('scan'));
create policy po_delete on public.purchase_orders for delete to authenticated using (public.has_cap('manage'));

create policy sync_select on public.sync_runs for select to authenticated using (public.can_read());

-- auditoria: só admin lê; ninguém edita ou apaga pela API
create policy audit_select on public.audit_log for select to authenticated using (public.has_cap('admin'));
