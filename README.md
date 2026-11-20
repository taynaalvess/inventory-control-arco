# Arco Estoque

Controle de estoque com dashboard, bipagem por leitor ou câmera, compras, kits, métricas e lucro por loja, e integração com o **UpSeller**. Segurança forte e custo **R$ 0**.

**Site:** https://taynaalvess.github.io/inventory-control-arco/

| Peça | Serviço | Plano |
|---|---|---|
| Site | GitHub Pages | grátis |
| Versionamento e deploy automático | GitHub + Actions | grátis |
| Banco, login e MFA | Supabase | grátis (500 MB) |
| Sincronização UpSeller | GitHub Actions (agendado) | grátis |

## Funcionalidades

**Operação**
- **Bipagem** com leitor USB/Bluetooth ou câmera do celular. Cinco modos: entrada, saída, venda (com loja), devolução e **inventário**. O inventário mostra as divergências e ajusta o saldo.
- **Compras:** pedidos a fornecedores (rascunho → enviado → recebido parcial ou total).
  - O **recebimento é feito por bipagem**, conferindo item a item.
  - Cada recebimento atualiza o **custo médio ponderado** do produto.
- **Sugestão de compra automática.** O cálculo considera:
  - o consumo dos últimos 30 dias;
  - o prazo do fornecedor;
  - o estoque mínimo;
  - os pedidos já em aberto.

  O resultado vira pedidos de compra, um por fornecedor.
- **Kits e combos:** vender um kit baixa cada componente. O saldo do kit é calculado pelos componentes.
- **Etiquetas** com código de barras (EAN-13 ou Code128).

**Gestão**
- **Dashboard** com faturamento, pedidos, ticket médio, **lucro líquido**, valor em estoque, ruptura, reposição, cobertura em dias, estoque parado e curva ABC.
- **Lojas:** comissão e taxa fixa por marketplace, lucro e margem líquida, **meta mensal com projeção** e comparativo entre lojas.
- **Ficha do produto:** kardex (histórico com saldo linha a linha), gráfico de saldo, vendas por loja e kits em que o produto entra.
- **Relatórios exportáveis:**
  - posição de estoque;
  - lucro por loja;
  - curva ABC;
  - vendas por produto × loja;
  - giro e cobertura;
  - estoque parado;
  - ajustes e divergências;
  - compras recebidas.
- **UpSeller:** importação de planilhas e sincronização automática pela API.

## Segurança

Num site estático, uma senha verificada só no navegador pode ser burlada. Por isso **toda a proteção está no banco de dados** (Supabase/Postgres, Row Level Security). Mesmo quem abrir o código do site ou chamar a API direto só recebe o que o seu perfil permite.

| Camada | Como funciona |
|---|---|
| Login | E-mail e senha do Supabase. O cadastro público fica desligado: só o admin cria usuários. |
| Verificação em 2 etapas (MFA) | App autenticador (TOTP) **obrigatório e exigido pelo banco**. Sem o código, não sai nenhum dado, mesmo com a senha certa. |
| Perfis | **Admin**: tudo.<br>**Gestor**: cadastros, compras, importação e relatórios.<br>**Operador**: bipagem e recebimento, sem ver valores na tela.<br>**Leitura**: só consulta. Cada regra vale dentro do banco. |
| Conta desativada | Perde o acesso na hora, mesmo com a sessão aberta. |
| Movimentações | São imutáveis (não existe edição). Corrigir é sempre um estorno, e o saldo só muda por trigger. |
| Auditoria | Registro imutável de quem criou, alterou ou excluiu o quê. Nem o admin consegue apagar. |
| Sessão | Logout automático por inatividade (30 min, configurável). |
| Senha | Mínimo de 12 caracteres, com maiúscula, minúscula, número e símbolo. Recuperação por e-mail em fluxo PKCE. Tentativas erradas causam bloqueio progressivo. |
| Navegador | Content-Security-Policy bloqueia scripts injetados e só permite conexão com o Supabase. HTTPS sempre. |
| Ambiente | Com as variáveis do Supabase no build, o site fica **travado no modo nuvem**: sem modo local e sem como apontar para outro servidor. |
| Segredos | Os tokens do UpSeller e a `service_role` ficam só nos *secrets* do GitHub, nunca no site. |

Limitação conhecida: o operador não vê custos na tela, mas tecnicamente consegue lê-los pela API, porque o Postgres não esconde colunas por usuário. Para esconder custos dele de vez, seria preciso uma view separada. Se for necessário, isso pode ser feito.

## Como colocar em produção (passo a passo)

### 1. Supabase
1. Crie um projeto grátis em <https://supabase.com>.
2. Abra **SQL Editor → New query**, cole [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**. Pode rodar de novo sempre que o arquivo for atualizado.
3. Em **Authentication → Users → Add user**, crie **o seu** usuário primeiro. O primeiro usuário vira **admin** automaticamente.
4. Faça a blindagem (lista também disponível em *Administração → Segurança*, no app):
   - **Sign In / Providers:** desligar *Allow new users to sign up*.
   - **Email:** ligar *Confirm email* e *Secure password change*.
   - **Password policy:** mínimo 12, com letras, números e símbolos.
   - **URL Configuration → Site URL:** `https://taynaalvess.github.io/inventory-control-arco/`.
   - **Multi-Factor:** TOTP habilitado.

### 2. GitHub
Em **Settings → Secrets and variables → Actions → Variables**, crie:
- `VITE_SUPABASE_URL` = Project URL;
- `VITE_SUPABASE_ANON_KEY` = chave *anon public*.

Depois rode **Actions → Deploy no GitHub Pages → Run workflow**.

### 3. Primeiro acesso
Entre no site com o seu usuário e escaneie o QR code no app autenticador. Pronto. Para adicionar a equipe:
1. Crie as pessoas em *Supabase → Authentication → Add user*.
2. No app, em **Administração → Usuários**, escolha o perfil de cada uma.

## UpSeller

- **Planilha (qualquer plano):** exporte estoque e pedidos no UpSeller e importe em *Integração UpSeller*. As colunas são reconhecidas automaticamente e reimportar não duplica.
- **API (planos Pro, Enterprise e Enterprise Plus):** gere o token em *Plataforma Aberta → API / MCP*.
  - **Secrets:** `UPSELLER_API_TOKEN`, `UPSELLER_CLIENT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
  - **Variables:** `UPSELLER_BASE_URL`, `UPSELLER_EP_INVENTORY`, `UPSELLER_EP_ORDERS` e `UPSELLER_SYNC_ENABLED=true`.
  - O workflow roda a cada 30 minutos.
  - ⚠️ Os endpoints estão no guia do UpSeller (Feishu, exige login). Confira-os antes de ligar e teste primeiro com *Run workflow → Simulação*.

## Desenvolvimento

```bash
npm install
npm run dev     # http://localhost:5173 — sem Supabase, roda em modo local
npm run build
```

```
src/lib/          regras: store (estado, permissões, kits, compras), métricas, importadores
src/lib/db/       camada de dados: local (IndexedDB) e Supabase
src/pages/        Dashboard, Bipagem, Produtos (+ficha), Compras, Movimentações, Lojas,
                  Relatórios, UpSeller, Administração, Configurações, telas de login/MFA
supabase/         schema.sql: tabelas, triggers (saldo, custo médio, auditoria), RLS por perfil
scripts/          upseller-sync.mjs (GitHub Actions)
```
