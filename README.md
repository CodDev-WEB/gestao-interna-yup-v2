# Gestão Interna — YUP Intelligence

Central de inteligência gerencial da **Yup Petstore**: estoque, vendas, validades, custos, fornecedores, clientes, setores (Alimentação, Farmácia, Diversos) e pontos a atacar, com dados extraídos da API do **Santarém Sistemas (Meu ERP Online)**.

```
Santarém Sistemas (API de consulta SQL, 20 req/min, até 100 linhas por página)
        │  POST /publica/api/consulta/sql/v1  {"sql": "SELECT …"}   (consultas fixas, só SELECT)
        ▼
Cloudflare Worker  gestao-interna-yup   cron */5 · rotas /api/* (Bearer ADMIN_TOKEN)
        ▼
Supabase (Postgres)
  erp_*        espelho tipado das tabelas do ERP (25 jobs, 22 tabelas)
  vw_*         análises: vendas, lucro, estoque parado, validade, fornecedores, clientes, setores
  sync_*       estado, execuções, trava e configuração da sincronização
```

## Site

**https://gestao-interna-yup.jordano-19-silva.workers.dev** — login com e-mail e senha do Supabase Auth (perfil admin).

| Tela | O que mostra |
|---|---|
| Visão geral | Capital em estoque por situação, faturamento/lucro/margem/ticket vs. período anterior, pontos a atacar ordenados por impacto, faturamento diário |
| Produtos e estoque | Cada variação com estoque, valor a custo, giro 90 dias, situação; aba de produtos em declínio |
| Validades | Lotes por faixa de vencimento e se a venda média esgota antes |
| Fornecedores | Total comprado, participação, ticket; preços de compra e aumentos |
| Clientes | Segmentos (VIP, recorrentes, em risco, inativos...), recência, próxima compra prevista |
| Setores | Alimentação, Farmácia e Diversos mês a mês; classificação das seções do ERP |
| Sincronização | Andamento da cópia do ERP, ligar/desligar o automático, sincronizar agora |

Código em `web/` (React + Vite). O Worker serve `dist/` e a API de leitura `/api/dash/*` (`src/dash.ts`). Publicar: `npm run deploy` (gera o site e faz o deploy).

## Estrutura

| Caminho | Papel |
|---|---|
| `src/index.ts` | Rotas `/api/*` e handler do cron |
| `src/sync/datasets.ts` | **Fonte única**: tabelas, colunas (conferidas com o dicionário do ERP), chaves, tipo de job e intervalo |
| `src/sync/engine.ts` | Motor: orçamento de subrequests, trava, jobs por prioridade, estado salvo a cada página |
| `src/sync/sql.ts` | Monta o SELECT com cursor (keyset) e janela; valida literais; só leitura |
| `src/sync/convert.ts` | Converte valores do ERP (números BR, datas, hora local → UTC) e recusa o que não converte |
| `src/sync/store.ts` | Gravação no Supabase (PostgREST) |
| `src/erp/client.ts` | HTTP com o ERP (do Gestão à Vista): auth, limite de 18 req/min, nova tentativa em 429/5xx |
| `scripts/mirror-sql.ts` | Gera `supabase/migrations/*_erp_mirror.sql` a partir de `datasets.ts` |
| `supabase/migrations/` | Controle da sincronização, espelho e views (todas idempotentes) |
| `test/run.ts` | Teste ponta a ponta com ERP e Supabase simulados em Postgres local (PGlite) |

## Como a sincronização funciona

- **snapshot** (cadastros, saldos, lotes, custos, preços, inventários): varre a tabela inteira a cada intervalo; o que sumiu do ERP é marcado em `sync_deleted_at` (nada é apagado).
- **append** (documentos, itens, custos dos itens, históricos): lê só chaves maiores que o cursor; o cursor nunca volta.
- **recent** (documentos, itens e custos dos últimos `recent_days` dias, padrão 7): relê a janela a cada 3 h para pegar cancelamentos, devoluções e correções.

A leitura é por **keyset** (`WHERE (chave) > (último lido) ORDER BY chave`), então páginas menores que o pedido não pulam nem repetem linhas. Cada execução respeita `SYNC_MAX_SUBREQUESTS` (45; o plano Free do Workers permite 50 por invocação) e salva o estado a cada página: o que não couber continua na próxima execução (cron a cada 5 min). Um job com erro de dados não para os outros e espera 15 min para tentar de novo. Credencial inválida ou ERP fora do ar param a execução inteira.

**Volume real (17/11/2026):** ~944 mil registros (104 mil documentos, 242 mil itens, 212 mil linhas de histórico de estoque). O ERP limita a 20 req/min de 100 linhas: a **carga inicial leva ~8–9 h** (`scripts/yup.ps1 carga-completa`). Depois, o cron mantém tudo em dia: documentos novos a cada 5 min, releitura dos últimos 7 dias a cada 12 h, saldos a cada 6 h, lotes a cada 12 h, cadastros, custos e preços diariamente. No plano pago do Workers, suba `SYNC_MAX_SUBREQUESTS` e encurte os intervalos em `datasets.ts`.

## Acesso

Login do **Supabase Auth** (e-mail e senha), como no Gestão à Vista: só perfis ativos com `role = 'admin'` em `public.profiles` usam `/api/*`. Para criar um admin: Authentication → Users → Add user (Auto Confirm) e depois
`insert into profiles (id, full_name, role, active) select id, 'Nome', 'admin', true from auth.users where email = '...';`
`ADMIN_TOKEN` é opcional, só para automações.

## Operação (`scripts/yup.ps1`, no PowerShell)

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\yup.ps1 login
```

| Ação | O que faz |
|---|---|
| `segredos` | Grava `ERP_TOKEN`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no Worker (lê da área de transferência e valida o formato) |
| `login` | E-mail e senha do admin; guarda só a sessão em `%USERPROFILE%\.yup-sessao.json` |
| `validar` | Testa ERP e Supabase e confere todas as colunas no ERP real |
| `contar` | Registros por tabela no ERP |
| `carga` / `carga-completa` | Uma rodada / repete até terminar (log em `carga.log`) |
| `status` | Estado de cada job |
| `ligar` / `desligar` | Sincronização automática (cron) |

Diagnóstico sem expor segredos: `GET /api/health?diag=1`.

## Rotas (todas, exceto health e auth, exigem sessão de admin: `Authorization: Bearer <access_token>`)

| Rota | O que faz |
|---|---|
| `POST /api/auth/login` | `{"email", "password"}` → sessão (só perfil admin ativo) |
| `POST /api/auth/refresh` | `{"refresh_token"}` → sessão renovada |
| `GET /api/health` | Quais Secrets estão configurados (sem valores); `?diag=1` mostra formato e alcance do Supabase |
| `POST /api/erp/test` | Testa autenticação e formato da resposta |
| `POST /api/erp/schema-check` | Confere colunas e tipos de cada tabela no ERP. Corpo opcional `{"datasets": [...]}` (todas ≈ 70 s) |
| `POST /api/erp/counts` | Registros por tabela no ERP. Corpo opcional `{"datasets": [...]}` |
| `GET /api/supabase/test` | Acesso ao Supabase e migrações aplicadas |
| `GET /api/sync/status` | Estado de cada job e últimas execuções |
| `POST /api/sync/run` | Executa agora os jobs devidos; `{"datasets": [...]}` força jobs específicos |
| `POST /api/sync/settings` | `{"auto_enabled": true, "recent_days": 7, "jobs": {"mercadoria_estoque_historico": false}}` |
| `POST /api/sync/reset` | Recomeça jobs do zero: `{"datasets": ["documento"]}` |

## Análises (views no Supabase)

| View | Responde |
|---|---|
| `vw_venda_item`, `vw_devolucao_item`, `vw_compra_item` | Itens classificados, com custo e lucro bruto |
| `vw_venda_diaria` | Faturamento, devoluções, custo, lucro, margem, ticket médio por dia |
| `vw_produto_desempenho` | Estoque, valor parado, giro, cobertura, situação (`sem_saida_historica`, `parado`, `baixa_movimentacao`, `excesso_estoque`, `ruptura`, `saudavel`) |
| `vw_lote_validade` | Lotes por faixa de vencimento, valor em risco e se a venda média esgota antes |
| `vw_fornecedor_resumo`, `vw_fornecedor_preco_item` | Total comprado, ticket, participação; menor/maior/último preço e variação |
| `vw_setor_mensal` | Faturamento, lucro e crescimento por setor e mês |
| `vw_cliente_rfm` | Recência, frequência, valor, próxima compra prevista e segmento |
| `vw_produto_declinio` | Queda de vendas em 3 meses seguidos (com estoque, para separar de ruptura) |
| `vw_resumo_gestao` | Uma linha com os pontos a atacar |

**A validar com a loja:** critério de compra (`tipomovimento='E'`, `tipomovimentofinanceiro='P'`, `status='E'`, modelo ≠ `TM`) e se o custo do item (`documento_mercadoria_custo`) é por unidade de `qtd`. Os critérios de venda e devolução são os mesmos já validados no Gestão à Vista. Itens sem custo aparecem em `itens_sem_custo` (o lucro do dia exclui esses itens).

## Desenvolvimento

Requisitos: Node.js 20+.

```bash
npm install
npm test            # teste ponta a ponta (ERP e Supabase simulados)
npm run typecheck
npm run gen:sql     # depois de mudar src/sync/datasets.ts
cp .dev.vars.example .dev.vars && npm run dev
```

Infra: Worker `https://gestao-interna-yup.jordano-19-silva.workers.dev` · Supabase `udrsdiuzztelysxiozpl` (us-west-2).
