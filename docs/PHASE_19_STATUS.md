# Fase 19 — Auditoria de integridade entre módulos

## Correções aplicadas

### Relatórios
- relatórios agora distinguem `REALIZED` e `PROJECTED`;
- padrão dos relatórios é realizado, evitando que PENDING/PLANNED apareçam como gasto efetivo;
- fluxo de caixa passa a separar pagamentos de cartão;
- pagamento de cartão reduz caixa, mas continua fora da despesa para evitar dupla contagem.

### Orçamentos
- gasto do orçamento considera apenas despesas realizadas;
- mês agora exige formato YYYY-MM válido;
- categoria de orçamento deve ser de despesa;
- motor impede orçamento ativo duplicado para a mesma categoria/mês quando recebe o conjunto de dados.

### Transações
- transações CANCELLED continuam sendo estruturalmente validadas; cancelamento apenas exclui o movimento dos cálculos financeiros.

## Decisões de integridade
- COMPRA NO CARTÃO = despesa na data da compra;
- PAGAMENTO DA FATURA = saída de caixa, não uma nova despesa;
- TRANSFERÊNCIA = movimento entre contas, não receita/despesa;
- PENDING/PLANNED = projeção, não realizado;
- CANCELLED = preservado para histórico, sem impacto financeiro.

## Pontos ainda deliberadamente pendentes
- alocação individual de pagamentos às faturas/parcelas;
- política formal para alteração de saldo inicial após existência de transações;
- imutabilidade/auditoria de alterações históricas de fechamento/vencimento de cartão;
- resolução visual de conflitos de sincronização;
- execução real de typecheck/test/build, bloqueada pelo HTTP 403 do registry npm.

## Resultado
Esta fase reduz principalmente o risco de dupla contagem e de misturar previsão com realizado nos relatórios.
