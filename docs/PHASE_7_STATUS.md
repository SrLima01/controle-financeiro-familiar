# Fase 7 — Transações

## Implementado

- Lançamentos reais para INCOME, EXPENSE, TRANSFER e CARD_PAYMENT.
- Valores convertidos e validados em centavos inteiros.
- Data do lançamento armazenada no formato financeiro YYYY-MM-DD.
- Status de fluxo: pendente, planejado, pago/recebido e cancelado.
- Validação pelo motor financeiro antes da persistência.
- Transferência exige conta de origem e destino diferentes.
- Compra no cartão referencia cartão e não conta bancária.
- Pagamento de cartão exige conta bancária e cartão; o motor trata como saída de caixa, sem criar uma segunda despesa.
- Edição recalcula os saldos porque os saldos são derivados das transações.
- Cancelamento preserva o registro histórico e deixa de afetar os cálculos.
- Filtros por tipo de lançamento.
- Persistência local atômica via IndexedDB e sincronização otimista com controle de versão.

## Integridade

Não foi criada uma tabela separada de fatura nesta fase. O vínculo da compra ao cartão permanece no Transaction.creditCardId; a modelagem de fatura será tratada na fase de cartões, quando regras de fechamento e vencimento puderem ser implementadas sem duplicação.

Não há exclusão física de transações na interface.

## Pendente

- Testes automatizados no ambiente CI/local.
- Busca textual e filtro por período.
- Regras completas de fatura, limite e fechamento de cartões.
- Parcelamentos e recorrências.
- Resolução visual de conflitos de sincronização.
- Definição final de imutabilidade do saldo inicial após existência de transações.

## Validação de ambiente

Os testes, typecheck e build ainda dependem de instalação das dependências. Nas fases anteriores o registry npm retornou HTTP 403; portanto não declarar execução local desses comandos até que o ambiente permita a instalação.
