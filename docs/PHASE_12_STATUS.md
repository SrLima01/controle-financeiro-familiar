# Fase 12 — Orçamentos por categoria

## Implementado
- Entidade `Budget`: mês, categoria, limite e estado ativo.
- Um orçamento ativo por categoria/mês.
- Gasto realizado derivado diretamente das transações.
- A despesa é atribuída ao mês da **data da compra**.
- Compras no cartão entram no mês da compra.
- Lançamentos CANCELLED são excluídos.
- Alertas:
  - < 80%: normal;
  - >= 80%: atenção;
  - > 100%: excedido.
- Edição e arquivamento sem apagar histórico.
- IndexedDB DB_VERSION 4.
- Backups antigos recebem `budgets: []`.
- Interface mobile em "Mais".

## Integridade
O orçamento não cria lançamentos financeiros e não altera saldo de conta ou limite de cartão. Ele apenas compara gastos derivados das transações contra um limite mensal.

## Limitações
- Não há orçamento consolidado de múltiplas categorias.
- Não há rollover de saldo entre meses.
- Não há metas percentuais de renda.
- Não há previsão automática de gasto até o fim do mês nesta fase.

## Validação
Testes de domínio foram escritos. Execução de Vitest/typecheck/build permanece pendente porque o ambiente continua sem acesso ao registry npm (HTTP 403).
