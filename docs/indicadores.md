# Dicionário de indicadores

Cada indicador do YUP Intelligence com a fórmula, de onde vem no banco e a meta inicial. As metas valem para os três primeiros meses e são revistas com o histórico completo. Referência teórica: Ronald H. Ballou, *Gerenciamento da Cadeia de Suprimentos/Logística Empresarial*, 5ª ed. (cap. 3, 9 e 16).

| Indicador | Fórmula | Fonte | Meta inicial | Onde aparece |
| --- | --- | --- | --- | --- |
| Faturamento líquido | vendas − devoluções | `vw_venda_diaria`, `vw_custo_servico_mensal` | crescer acima da inflação | Visão geral, Resumo do mês |
| Margem bruta | (faturamento − custo do vendido) ÷ faturamento | `vw_venda_diaria`, `vw_custo_servico_mensal` | ≥ 35% (Petz: 39,6% no 3T25) | Visão geral, Resumo do mês |
| Ticket médio | faturamento ÷ número de vendas | `vw_venda_diaria` | +5% ao ano | Visão geral, Resumo do mês |
| Desconto | descontos ÷ faturamento bruto | `vw_custo_servico_mensal` | ≤ 4% | Resumo do mês |
| Devolução | devoluções ÷ faturamento | `vw_custo_servico_mensal` | ≤ 1% | Resumo do mês |
| Perda por validade | custo dos lotes vencidos com saldo | `vw_custo_servico_mensal`, `vw_lote_validade` | ≤ 0,5% do custo do vendido | Resumo do mês, Validades, Qualidade do dado |
| Classe ABC | itens que somam 80% do faturamento do último ano = A; os próximos 15% = B; o resto = C | `vw_produto_abc` | — | Produtos (Curva ABC), Compras, Conciliação |
| Cobertura | estoque ÷ venda média diária | `vw_reposicao`, `vw_produto_desempenho` | A: 15–30 dias; B: 30–60; C: ≤ 90 | Produtos, Compras |
| Ponto de pedido | venda média × prazo + z × desvio × √prazo | `vw_reposicao`, `cfg_reposicao` | — | Compras |
| Estoque de segurança | z × desvio diário × √prazo | `vw_reposicao` | — | Compras |
| Acurácia do estoque | itens contados sem diferença ÷ itens contados | `vw_contagem_acuracia` | A: 98%; B e C: 95% | Conciliação |
| Qualidade do cadastro | itens com estoque negativo, sem custo, sem EAN, sem NCM, lote vencido com saldo | `vw_qualidade_resumo` | zero na classe A | Qualidade do dado |
| Clientes em risco | clientes que passaram do dobro do intervalo habitual sem comprar | `vw_cliente_rfm` | — | Clientes |

## Nível de serviço e o fator z

O nível de serviço é a fração da demanda atendida com o estoque disponível (Ballou, eq. 9-1). O fator z vem da distribuição normal:

| Classe | Nível de serviço | z |
| --- | --- | --- |
| A | 98% | 2,05 |
| B | 95% | 1,65 |
| C | 90% | 1,28 |

Os valores ficam na tabela `cfg_reposicao` e podem ser alterados no Supabase.

## Data de referência durante a carga

Enquanto a carga do ERP não chega a hoje, as views de curva ABC, reposição e qualidade usam como "hoje" a data da última venda carregada. As telas avisam no topo até onde as vendas e os custos já foram copiados.
