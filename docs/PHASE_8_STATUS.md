# Fase 8 — Cartões

## Implementado

- Cadastro, edição e arquivamento de cartões.
- Limite de crédito, conta de pagamento, dia de fechamento e vencimento.
- Motor determinístico para ciclo da fatura.
- Cálculo de fatura atual, total em aberto e limite disponível.
- Compra no cartão não reduz saldo bancário.
- Pagamento de cartão reduz a conta vinculada e reduz o saldo em aberto do cartão.
- Compra nova é rejeitada quando excede o limite disponível.
- Histórico preservado por arquivamento.
- Testes de domínio adicionados para ciclo, vencimento, limite e pagamentos.

## Decisões

A fatura é derivada das transações nesta fase; não foi criada uma entidade persistente de fatura para evitar duplicação de fonte de verdade.

O ciclo considera o dia de fechamento: compras até o fechamento pertencem ao ciclo que fecha naquele dia; compras após o fechamento pertencem ao próximo ciclo.

## Pendente

- Tela detalhada de fatura por cartão.
- Seleção explícita de uma fatura para pagamento.
- Parcelamento de compras.
- Regras avançadas para pagamentos parciais e múltiplas faturas em aberto.
- Testes, typecheck e build completos no ambiente, ainda bloqueados pela limitação anterior do registry npm (HTTP 403).
