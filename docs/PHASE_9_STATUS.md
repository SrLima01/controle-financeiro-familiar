# Fase 9 — Parcelamentos

## Implementado
- Criação de parcelamentos como um único grupo lógico ligado a N transações.
- Divisão em centavos com o restante aplicado às primeiras parcelas.
- Datas mensais usando calendário financeiro local, incluindo ajuste seguro para meses menores.
- Cada parcela recebe seu próprio lançamento e ID.
- Parcelamento em conta ou cartão de crédito.
- Compras parceladas no cartão permanecem como despesas e entram na fatura correspondente pela data de cada parcela.
- Cancelamento preservando histórico: somente esta parcela ou esta e as seguintes.
- Testes de domínio para divisão, datas, vínculo e cancelamento.

## Integridade
- O grupo não substitui as transações: as transações continuam sendo a fonte de verdade financeira.
- Não há exclusão física de parcelas.
- Soma das parcelas é exatamente o valor total em centavos.
- IDs do grupo e das transações são vinculados explicitamente.
- O parcelamento de cartão não reduz saldo bancário; cada parcela é uma compra do cartão.

## Limitações deliberadas desta fase
- Alteração de valor de uma parcela ou de toda a série ainda exige uma política de edição auditável; não é feita silenciosamente.
- Pagamentos de cartão continuam agregados pelo motor de cartões, sem alocação explícita a uma parcela/fatura.
- A interface prioriza criação e cancelamento seguro. Edição de uma série será adicionada quando a regra de recálculo de parcelas estiver formalizada.

## Validação
- Testes foram escritos, mas a execução de npm/Vitest, typecheck e build continua pendente enquanto o ambiente não consegue acessar o registry npm (HTTP 403).
