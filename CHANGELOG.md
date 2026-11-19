# Registro de mudanças

## 2026-11-19 — Gestão do estoque

- **Carga mais rápida:** o cron passa de 5 em 5 minutos para todo minuto. Com o mesmo orçamento de subrequests por execução, a cópia do ERP anda cerca de 5 vezes mais rápido e alcança as vendas de 2026.
- **Compras:** sugestão de compra por ponto de pedido e estoque de segurança, por classe ABC.
- **Conciliação:** contagem cíclica pelo celular (contagem às cegas) e acurácia do estoque por mês e classe.
- **Qualidade do dado:** estoque negativo, sem custo, sem código de barras, sem NCM e lote vencido com saldo.
- **Produtos:** classe ABC em cada item e aba Curva ABC (Pareto).
- **Resumo do mês:** relatório de custo-serviço com margem, descontos, devoluções e perda por validade.
- **Segurança do banco:** `search_path` fixo nas funções `vazio_null` e `ncm_limpo`; `rls_auto_enable` sem execução pública.
- **CI:** pull requests passam a rodar tipos, testes e build antes do merge (sem publicar).
- **Documentação:** `docs/indicadores.md`, `docs/contagem.md`, `docs/compras.md`.

## 2026-11-19 — Interface

- Contraste WCAG AA, área de toque de 44px, carregamento visível nas tabelas, foco preso na ficha do produto (PR #1).
- Link para pular o menu, foco no conteúdo ao trocar de página, campos com 16px no celular, resumo em texto nos gráficos (PR #2).
