# Procedimento de compras

A tela **Compras** lista os itens que chegaram ao ponto de pedido e sugere quanto comprar. A regra é a do ponto de pedido com estoque de segurança (Ballou, cap. 9).

## Como a sugestão é calculada

- **Venda média diária e desvio:** últimos 90 dias de venda carregados, contando os dias sem venda como zero.
- **Ponto de pedido:** venda média × prazo de entrega + z × desvio × √prazo. O segundo termo é o estoque de segurança.
- **Máximo:** ponto de pedido + venda média × dias entre revisões.
- **Sugestão:** quando o estoque está no ponto de pedido ou abaixo, compra-se o que falta para chegar ao máximo. Estoque negativo conta como zero.

| Classe | Nível de serviço | Prazo padrão | Revisão |
| --- | --- | --- | --- |
| A | 98% | 7 dias | semanal |
| B | 95% | 7 dias | quinzenal |
| C | 90% | 7 dias | mensal |

Os parâmetros ficam na tabela `cfg_reposicao` do Supabase. O prazo de 7 dias é um ponto de partida: ajuste com o prazo real dos fornecedores principais.

## Quando não seguir a sugestão

- **Demanda irregular** (marcado na tela): o desvio é maior que a média. O livro recomenda o sistema mín-máx para esses itens; confira o histórico antes de comprar.
- **Item em promoção, sazonal ou em lançamento:** a média dos últimos 90 dias não representa o próximo período.
- **Desconto por quantidade:** comprar acima do máximo pode compensar se o desconto pagar o custo de manter o estoque (Ballou, cap. 10).
- **Carga incompleta:** enquanto a tela avisar que as vendas ainda não chegaram a hoje, use a lista como conferência, não como pedido.
- **Validade curta:** para ração e medicamento, não compre mais do que vende antes de vencer (ver **Validades**).
