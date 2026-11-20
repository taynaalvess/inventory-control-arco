-- =====================================================================
-- Arco Estoque — schema do Supabase (plano gratuito)
-- Cole este arquivo inteiro em: Supabase → SQL Editor → New query → Run
-- Pode rodar de novo sem problemas (idempotente).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Lojas / canais ----------
create table if not exists public.stores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  channel     text not null default 'Outro',
  color       text not null default '#6366f1',
  active      boolean not null default true,
  upseller_id text,
  created_at  timestamptz not null default now()
);
create unique index if not exists stores_name_key on public.stores (lower(name));

-- ---------- Produtos ----------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  sku         text not null,
  ean         text,
  name        text not null,
  category    text not null default '',
  brand       text not null default '',
  cost        numeric(12,2) not null default 0,
  price       numeric(12,2) not null default 0,
  min_stock   integer not null default 0,
  location    text not null default '',
  stock       integer not null default 0,   -- mantido pelo trigger das movimentações
  image_url   text not null default '',
  active      boolean not null default true,
  upseller_id text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists products_sku_key on public.products (lower(sku));
create unique index if not exists products_ean_key on public.products (ean) where ean is not null and ean <> '';

-- ---------- Movimentações (trilha de auditoria) ----------
create table if not exists public.movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  type          text not null check (type in ('entrada','saida','venda','devolucao','ajuste')),
  qty           integer not null,               -- com sinal: + entra, - sai
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

-- Saldo sempre consistente: cada movimentação atualiza o estoque do produto
create or replace function public.apply_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.affects_stock then
      update products set stock = stock + new.qty, updated_at = now() where id = new.product_id;
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
create trigger movements_apply
  after insert or delete on public.movements
  for each row execute function public.apply_movement();

-- O app nunca grava "stock" direto em products; isso protege contra edição manual acidental
create or replace function public.protect_stock() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() = 1 and new.stock is distinct from old.stock then
    new.stock := old.stock;
  end if;
  return new;
end $$;

drop trigger if exists products_protect_stock on public.products;
create trigger products_protect_stock
  before update on public.products
  for each row execute function public.protect_stock();

-- ---------- Log das sincronizações automáticas ----------
create table if not exists public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running',
  message     text not null default '',
  stats       jsonb not null default '{}'::jsonb
);

-- ---------- Segurança (RLS): só usuários logados acessam ----------
alter table public.stores    enable row level security;
alter table public.products  enable row level security;
alter table public.movements enable row level security;
alter table public.sync_runs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['stores','products','movements'] loop
    execute format('drop policy if exists "auth_all" on public.%I', t);
    execute format('create policy "auth_all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
  drop policy if exists "auth_read" on public.sync_runs;
  create policy "auth_read" on public.sync_runs for select to authenticated using (true);
end $$;

-- Movimentações são auditoria: impedimos edição (estorno = nova movimentação)
drop policy if exists "auth_all" on public.movements;
drop policy if exists "mov_select" on public.movements;
drop policy if exists "mov_insert" on public.movements;
drop policy if exists "mov_delete" on public.movements;
create policy "mov_select" on public.movements for select to authenticated using (true);
create policy "mov_insert" on public.movements for insert to authenticated with check (true);
create policy "mov_delete" on public.movements for delete to authenticated using (true);
