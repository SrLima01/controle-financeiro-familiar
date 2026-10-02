# Fase 10 — Recorrências

## Implementado
- Entidade `RecurringRule` persistida localmente e sincronizada dentro do estado financeiro.
- Frequências: semanal, quinzenal, mensal, bimestral, trimestral, semestral e anual.
- Data inicial e data final opcional.
- Geração de lançamentos futuros como transações normais.
- Ao criar uma regra, são gerados os próximos 12 meses.
- A ação "Gerar próximos" pode estender a série sem duplicar datas já geradas.
- Desativação da regra preserva todos os lançamentos já gerados.
- Compatibilidade de backup/estado remoto antigo: estados anteriores à Fase 10 recebem `recurringRules: []`.
- Regras de despesa podem usar conta ou cartão; o lançamento recorrente precisa ter conta para movimentar o motor financeiro.
- Testes para progressão de datas, geração sem duplicação e data final.

## Integridade
- A regra é uma configuração de geração; as transações geradas continuam sendo a fonte de verdade financeira.
- Não há exclusão física de lançamentos.
- Desativar uma regra não cancela retroativamente os lançamentos já gerados.
- Alterar uma regra que já possui lançamentos gerados está bloqueado nesta fase para evitar alteração silenciosa do histórico.
- Não há geração duplicada quando a regra é processada novamente.

## Limitações deliberadas
- "Atualizar este mês" e "atualizar todos os futuros" ainda não estão liberados, pois exigem política explícita para preservar lançamentos já pagos e alterações históricas.
- A série é pré-gerada por 12 meses; a ação "Gerar próximos" estende o horizonte.
- A interface ainda não possui uma fila/rotina automática diária para gerar novas ocorrências; a geração é acionada pelo fluxo da regra.

## Persistência
- IndexedDB foi atualizado para DB_VERSION 2 com o store `recurringRules`.
- O estado Supabase continua sendo o agregado JSON da família; a validação foi atualizada de forma compatível com estados anteriores.

## Validação
Os testes foram escritos, mas npm/Vitest, typecheck e build continuam pendentes enquanto o ambiente não consegue acessar o registry npm (HTTP 403).
