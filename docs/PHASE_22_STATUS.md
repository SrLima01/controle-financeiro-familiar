# Fase 22 — Validação financeira transversal

## Objetivo

Fortalecer as invariantes que impedem referências quebradas ou lançamentos estruturalmente inválidos de entrarem no motor financeiro.

## Implementado

- transações precisam ter valor maior que zero;
- descrição não pode ser vazia;
- referências opcionais a Pessoa e Categoria são validadas quando os cadastros estão disponíveis;
- categoria de despesa não pode ser usada em receita;
- categoria de receita não pode ser usada em despesa;
- destinationAccountId só é permitido em transferências;
- backup/importação agora executa a validação financeira completa com contas, cartões, pessoas e categorias;
- testes adicionais para essas invariantes.

## Integridade

Esta fase não altera valores históricos nem recalcula lançamentos. Ela fecha a porta para novos dados estruturalmente inconsistentes e faz o backup rejeitar estados incompatíveis.

A validação continua separando:
- despesa no cartão = despesa;
- pagamento do cartão = saída de caixa;
- transferência = movimentação entre contas;
- cancelado = histórico sem impacto financeiro.

## Limitações

Ainda não há alocação explícita de pagamentos às faturas. Essa continua sendo uma parte da revisão futura da Fase 08.

Testes, typecheck e build não foram executados devido à limitação anterior do registry npm (HTTP 403).
