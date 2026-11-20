#!/usr/bin/env node
/**
 * Sincronização UpSeller → Supabase (roda no GitHub Actions, de graça).
 *
 * O que faz:
 *  1. Estoque: lê o saldo por SKU no UpSeller e gera AJUSTES no Supabase para igualar o saldo
 *     (cria o produto se o SKU ainda não existir).
 *  2. Pedidos: lê pedidos das últimas N horas e grava como VENDAS por loja (alimenta as métricas).
 *     Por padrão as vendas NÃO baixam estoque (affects_stock=false), porque o saldo já vem do passo 1.
 *
 * ⚠️  A lista de endpoints da API aberta do UpSeller é distribuída pelo próprio UpSeller
 *     (Plataforma Aberta → API/MCP → "Guía detallada"). Preencha os caminhos e nomes de campos
 *     nas variáveis abaixo conforme esse guia. Sem os endpoints, o script só registra "skipped".
 *
 * Variáveis de ambiente (GitHub → Settings → Secrets and variables → Actions):
 *   Secrets:   UPSELLER_API_TOKEN, UPSELLER_CLIENT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   Variables: UPSELLER_BASE_URL          ex.: https://<host da API informado no guia>
 *              UPSELLER_EP_INVENTORY      caminho do endpoint de estoque por SKU
 *              UPSELLER_EP_ORDERS         caminho do endpoint de pedidos
 *              UPSELLER_WAREHOUSE_ID      (opcional) armazém a consultar
 *              UPSELLER_TOKEN_HEADER      (opcional) padrão: X-Upseller-Api-Token
 *              UPSELLER_CLIENT_HEADER     (opcional) padrão: X-Upseller-Client-Id
 *              UPSELLER_LOOKBACK_HOURS    (opcional) padrão: 48
 *              DRY_RUN=true               (opcional) só mostra o que faria, sem gravar
 *
 * Teste local:  UPSELLER_API_TOKEN=... SUPABASE_URL=... node scripts/upseller-sync.mjs
 */
import { createClient } from '@supabase/supabase-js';

const env = process.env;
const DRY = env.DRY_RUN === 'true';
const LOOKBACK_H = Number(env.UPSELLER_LOOKBACK_HOURS || 48);
const PAGE_SIZE = 100;

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'UPSELLER_API_TOKEN'];
for (const k of required) {
  if (!env[k]) {
    console.error(`✖ Variável ${k} não definida.`);
    process.exit(1);
  }
}

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/* ----------------------------- HTTP UpSeller ----------------------------- */

const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  [env.UPSELLER_TOKEN_HEADER || 'X-Upseller-Api-Token']: env.UPSELLER_API_TOKEN,
  ...(env.UPSELLER_CLIENT_ID ? { [env.UPSELLER_CLIENT_HEADER || 'X-Upseller-Client-Id']: env.UPSELLER_CLIENT_ID } : {}),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, body, attempt = 1) {
  const url = new URL(path, env.UPSELLER_BASE_URL).toString();
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (res.status === 429 && attempt <= 5) {
    // limite por minuto (Pro: 100/min) — espera e tenta de novo
    await sleep(15_000 * attempt);
    return call(path, body, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} → resposta não-JSON: ${text.slice(0, 200)}`);
  }
}

/** Encontra o primeiro array de objetos dentro da resposta (data.list, data.records, result.items…). */
function findList(obj, depth = 0) {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  for (const k of ['list', 'records', 'items', 'rows', 'data', 'result', 'orders', 'skus']) {
    const v = obj[k];
    const found = Array.isArray(v) ? v : findList(v, depth + 1);
    if (found) return found;
  }
  for (const v of Object.values(obj)) {
    const found = typeof v === 'object' ? findList(v, depth + 1) : null;
    if (found) return found;
  }
  return null;
}

/** Lê o primeiro campo existente entre vários nomes possíveis. */
const pick = (o, keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((x, p) => (x == null ? undefined : x[p]), o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

async function fetchAll(path, extra = {}) {
  const all = [];
  for (let page = 1; page <= 500; page++) {
    const json = await call(path, { pageNum: page, pageNo: page, page, pageSize: PAGE_SIZE, ...extra });
    const code = pick(json, ['code', 'status']);
    if (code !== undefined && ![0, 200, '0', '200', 'success', 'SUCCESS', true].includes(code)) {
      throw new Error(`${path} → erro da API: ${JSON.stringify(json).slice(0, 300)}`);
    }
    const list = findList(json) ?? [];
    all.push(...list);
    if (list.length < PAGE_SIZE) break;
  }
  return all;
}

/* ----------------------------- Supabase ----------------------------- */

async function sbAll(table, columns = '*') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function insertChunks(table, rows) {
  if (DRY || !rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

const norm = (s) => String(s ?? '').trim().toLowerCase();
const num = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/* ----------------------------- Sync ----------------------------- */

async function syncInventory(products) {
  const items = await fetchAll(env.UPSELLER_EP_INVENTORY, env.UPSELLER_WAREHOUSE_ID ? { warehouseId: env.UPSELLER_WAREHOUSE_ID } : {});
  const bySku = new Map(products.map((p) => [norm(p.sku), p]));
  const newProducts = [];
  const moves = [];

  for (const it of items) {
    const sku = pick(it, ['sku', 'skuCode', 'sku_code', 'merchantSku', 'sellerSku', 'productSku']);
    const qty = num(pick(it, ['availableQty', 'available', 'availableStock', 'available_quantity', 'stock', 'quantity', 'qty', 'onHand', 'inventory']));
    if (!sku || qty === null) continue;
    let p = bySku.get(norm(sku));
    if (!p) {
      p = {
        id: crypto.randomUUID(),
        sku: String(sku),
        name: String(pick(it, ['skuName', 'productName', 'name', 'title']) ?? sku),
        ean: pick(it, ['ean', 'gtin', 'barcode', 'upc']) ?? null,
        cost: num(pick(it, ['cost', 'costPrice', 'purchasePrice'])) ?? 0,
        price: num(pick(it, ['price', 'salePrice'])) ?? 0,
        upseller_id: pick(it, ['skuId', 'id']) != null ? String(pick(it, ['skuId', 'id'])) : null,
        stock: 0,
      };
      newProducts.push(p);
      bySku.set(norm(sku), p);
    }
    const delta = Math.round(qty) - (p.stock ?? 0);
    if (delta !== 0) {
      moves.push({ product_id: p.id, type: 'ajuste', qty: delta, unit_cost: p.cost ?? null, note: 'Sincronização UpSeller', source: 'upseller', affects_stock: true });
      p.stock = Math.round(qty);
    }
  }

  await insertChunks('products', newProducts.map(({ stock, ...p }) => p));
  await insertChunks('movements', moves);
  return { lidos: items.length, criados: newProducts.length, ajustes: moves.length };
}

async function syncOrders(products) {
  const to = new Date();
  const from = new Date(to.getTime() - LOOKBACK_H * 3600_000);
  const orders = await fetchAll(env.UPSELLER_EP_ORDERS, {
    startTime: from.toISOString(),
    endTime: to.toISOString(),
    beginTime: from.getTime(),
    finishTime: to.getTime(),
  });

  const bySku = new Map(products.map((p) => [norm(p.sku), p]));
  const stores = await sbAll('stores');
  const storeByName = new Map(stores.map((s) => [norm(s.name), s]));
  const { data: existingRows, error } = await sb
    .from('movements')
    .select('ref, product_id')
    .eq('type', 'venda')
    .gte('created_at', new Date(from.getTime() - 7 * 86400_000).toISOString());
  if (error) throw new Error(error.message);
  const existing = new Set(existingRows.map((r) => `${r.ref}|${r.product_id}`));

  const newStores = [];
  const moves = [];
  const unknown = new Set();
  const CANCEL = /cancel|refund|return|unpaid|devol|reemb/i;

  for (const o of orders) {
    const status = String(pick(o, ['status', 'orderStatus', 'state']) ?? '');
    if (CANCEL.test(status)) continue;
    const ref = String(pick(o, ['orderNo', 'orderSn', 'orderNumber', 'platformOrderNo', 'orderId', 'id']) ?? '');
    const shopName = String(pick(o, ['shopName', 'storeName', 'shop.name', 'store.name', 'platformShopName']) ?? '');
    const when = pick(o, ['orderTime', 'createTime', 'createdAt', 'payTime', 'orderDate']);
    const createdAt = when ? new Date(typeof when === 'number' && when < 1e12 ? when * 1000 : when) : new Date();

    let storeId = null;
    if (shopName) {
      let s = storeByName.get(norm(shopName));
      if (!s) {
        s = { id: crypto.randomUUID(), name: shopName, channel: String(pick(o, ['platform', 'platformName', 'channel']) ?? 'Outro') };
        storeByName.set(norm(shopName), s);
        newStores.push(s);
      }
      storeId = s.id;
    }

    const lines = pick(o, ['items', 'orderItems', 'skuList', 'products', 'lines']) ?? [];
    for (const l of lines) {
      const sku = pick(l, ['sku', 'skuCode', 'merchantSku', 'sellerSku', 'variationSku']);
      const p = sku ? bySku.get(norm(sku)) : null;
      if (!p) {
        if (sku) unknown.add(sku);
        continue;
      }
      if (existing.has(`${ref}|${p.id}`)) continue;
      existing.add(`${ref}|${p.id}`);
      const qty = Math.round(num(pick(l, ['quantity', 'qty', 'num', 'count'])) ?? 1) || 1;
      const unit = num(pick(l, ['price', 'unitPrice', 'salePrice', 'itemPrice'])) ?? p.price ?? 0;
      moves.push({
        product_id: p.id,
        type: 'venda',
        qty: -qty,
        unit_price: unit,
        unit_cost: p.cost ?? null,
        store_id: storeId,
        ref,
        source: 'upseller',
        affects_stock: false, // o saldo vem da sincronização de estoque
        created_at: createdAt.toISOString(),
      });
    }
  }

  await insertChunks('stores', newStores);
  await insertChunks('movements', moves);
  return { pedidos: orders.length, itens: moves.length, lojasNovas: newStores.length, skusDesconhecidos: unknown.size };
}

async function main() {
  const missingEp = ['UPSELLER_BASE_URL', 'UPSELLER_EP_INVENTORY', 'UPSELLER_EP_ORDERS'].filter((k) => !env[k]);
  let runId = null;
  if (!DRY) {
    const { data } = await sb.from('sync_runs').insert({ status: 'running' }).select('id').single();
    runId = data?.id ?? null;
  }
  const finish = async (status, message, stats = {}) => {
    console.log(`[${status}] ${message}`);
    if (runId) await sb.from('sync_runs').update({ status, message, stats, finished_at: new Date().toISOString() }).eq('id', runId);
  };

  if (missingEp.length) {
    await finish('skipped', `Configure as variáveis ${missingEp.join(', ')} conforme o guia da API do UpSeller.`);
    return;
  }

  try {
    let products = await sbAll('products', 'id, sku, stock, cost, price');
    const inv = await syncInventory(products);
    products = await sbAll('products', 'id, sku, stock, cost, price');
    const ord = await syncOrders(products);
    const stats = { estoque: inv, pedidos: ord, dryRun: DRY };
    await finish(
      'ok',
      `Estoque: ${inv.lidos} SKUs lidos, ${inv.ajustes} ajustes, ${inv.criados} novos · Pedidos: ${ord.itens} itens de ${ord.pedidos} pedidos${ord.skusDesconhecidos ? `, ${ord.skusDesconhecidos} SKUs desconhecidos` : ''}${DRY ? ' (simulação)' : ''}`,
      stats,
    );
  } catch (e) {
    await finish('error', String(e?.message ?? e));
    process.exitCode = 1;
  }
}

await main();
