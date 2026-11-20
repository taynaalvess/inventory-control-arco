# Arco Estoque

Controle de estoque com dashboard, bipagem por leitor ou câmera, métricas por loja e integração com o **UpSeller**. Custo: **R$ 0**.

| Peça | Serviço | Plano |
|---|---|---|
| Site | GitHub Pages | grátis |
| Versionamento e deploy automático | GitHub + Actions | grátis |
| Banco de dados e login (opcional) | Supabase | grátis (500 MB) |
| Sincronização com o UpSeller | GitHub Actions (agendado) | grátis |

## Funcionalidades

- **Dashboard**: faturamento, pedidos, ticket médio, margem bruta, valor em estoque, ruptura, reposição, cobertura em dias, estoque parado, curva ABC e vendas por loja. Filtros de período e de loja.
- **Bipagem** em 5 modos: entrada, saída, venda (com loja), devolução e **inventário** (contagem física com relatório de divergências e ajuste automático).
  - Leitor USB/Bluetooth: funciona como teclado. O foco volta sozinho para o campo de leitura.
  - Câmera do celular: lê EAN, Code128 e QR. Funciona no GitHub Pages porque o site é HTTPS.
  - Bipe sonoro e vibração. Código desconhecido → cadastro rápido na hora.
- **Produtos**: SKU, EAN, custo, preço, estoque mínimo e localização. Inclui exportação CSV e **impressão de etiquetas com código de barras**.
- **Movimentações**: histórico auditável de tudo. O saldo só muda por movimentação, e o estorno gera um novo lançamento.
- **Lojas**: cadastro por canal (Shopee, Mercado Livre, Amazon…) com métricas individuais e comparativo.
- **UpSeller**:
  - Importação de planilhas exportadas (produtos/estoque e pedidos), com reconhecimento automático de colunas e sem duplicar dados.
  - Sincronização automática pela API aberta, rodando no GitHub Actions.
- Modo claro e escuro, layout para celular e instalável como app (PWA).

---

## 1. Rodar no computador

```bash
npm install
npm run dev
```

Abra o endereço que aparecer no terminal. Em **Configurações → Dados de demonstração** você vê o painel funcionando com dados fictícios.

## 2. Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `inventory-control-arco`).
2. Envie o código:
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/inventory-control-arco.git
   git push -u origin main
   ```
3. No repositório, abra **Settings → Pages → Build and deployment → Source** e escolha **GitHub Actions**.
4. A cada `git push` na `main`, o workflow `deploy.yml` publica o site em `https://SEU-USUARIO.github.io/inventory-control-arco/`.

> Planos gratuitos do GitHub só publicam Pages de repositórios **públicos**. O código fica público, mas **os dados não**: eles ficam no Supabase, protegidos por login. Nenhuma senha ou token entra no código.

## 3. Banco na nuvem com Supabase (recomendado)

Sem o Supabase, o app funciona em **modo local**: os dados ficam só no navegador onde foram cadastrados. Para usar o mesmo estoque no celular (bipagem) e no computador (dashboard):

1. Crie um projeto grátis em <https://supabase.com>.
2. Abra **SQL Editor → New query**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
3. Em **Authentication → Users → Add user**, crie o seu usuário (e-mail e senha). Depois, em **Authentication → Sign In / Providers**, desative *Allow new users to sign up* para que ninguém mais crie conta.
4. Em **Project Settings → API**, copie a *Project URL* e a chave *anon public*.
5. Escolha uma das opções:
   - **Pelo site:** **Configurações → Nuvem (Supabase)** → cole os dados. Vale só para aquele navegador.
   - **Pelo GitHub (melhor):** em **Settings → Secrets and variables → Actions → Variables**, crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Rode o deploy de novo e todos os dispositivos já abrem conectados.
6. Se você já cadastrou dados no modo local, use **Configurações → Enviar dados locais para a nuvem**.

A chave *anon* é pública por natureza. Quem protege os dados é o login somado às regras de segurança (RLS) do `schema.sql`. **Nunca** coloque a chave `service_role` no site.

## 4. UpSeller

### a) Importação de planilhas (funciona hoje, em qualquer plano)

1. No UpSeller, exporte a lista de **estoque/produtos** (.xlsx).
2. No app, abra **Integração UpSeller → Importar planilha** e arraste o arquivo. Confira o mapeamento e importe.
3. Exporte os **pedidos** do período e importe da mesma forma. As lojas são criadas automaticamente pelo nome.
   - Se o saldo já vem do UpSeller (passo 1), desmarque **Baixar estoque**. Assim as vendas entram só nas métricas e o estoque não é baixado duas vezes.
   - Reimportar a mesma planilha não duplica pedidos.

### b) Sincronização automática pela API (planos Pro, Enterprise e Enterprise Plus)

1. No UpSeller, com a conta principal: **Plataforma Aberta → API / MCP → Gerar**. Copie o *ID de Cliente* e o *API Token*.
2. No GitHub, em **Settings → Secrets and variables → Actions**:
   - **Secrets:** `UPSELLER_API_TOKEN`, `UPSELLER_CLIENT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
   - **Variables:** `UPSELLER_BASE_URL`, `UPSELLER_EP_INVENTORY`, `UPSELLER_EP_ORDERS` e, por último, `UPSELLER_SYNC_ENABLED=true`.
3. O workflow `upseller-sync.yml` roda a cada 30 minutos. Ele iguala o saldo por SKU e grava os pedidos como vendas por loja. O histórico aparece no app.

> ⚠️ A documentação detalhada dos endpoints é distribuída pelo UpSeller (link "Guía detallada" dentro da Plataforma Aberta, num documento Feishu que exige login). Os caminhos dos endpoints, o host e os nomes de cabeçalho ficam configuráveis por variável. O script tenta os nomes de campos mais comuns, mas **confira tudo com o guia** e faça o primeiro teste em *Actions → UpSeller sync → Run workflow → Simulação*. Ajustes finos ficam em [`scripts/upseller-sync.mjs`](scripts/upseller-sync.mjs).

## Estrutura

```
src/
  lib/            regras de negócio (store, métricas, importadores, etiquetas)
    db/           camada de dados: local (IndexedDB) e Supabase
  components/     UI reutilizável, scanner de câmera, formulários
  pages/          Dashboard, Bipagem, Produtos, Movimentações, Lojas, UpSeller, Configurações
supabase/         schema.sql (tabelas, trigger de saldo, RLS)
scripts/          upseller-sync.mjs (roda no GitHub Actions)
.github/workflows deploy.yml (Pages) e upseller-sync.yml (agendado)
```

## Dicas de bipagem

- Leitores USB e Bluetooth baratos (modo "teclado/HID") funcionam direto, sem driver.
- No celular, abra o site e use **Adicionar à tela inicial**. Ele passa a funcionar como um app.
- Produtos sem EAN: imprima etiquetas em **Produtos → selecionar → Etiquetas**. O código gerado é o SKU em Code128.
