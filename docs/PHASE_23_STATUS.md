# Fase 23 — Relatórios realizado/projetado

## Implementado

- Relatórios agora possuem seleção explícita entre **Realizado** e **Projetado**.
- Realizado considera somente PAID/RECEIVED e exclui CANCELLED.
- Projetado considera todos os lançamentos não cancelados, incluindo PENDING e PLANNED.
- A seleção é aplicada a categorias, pessoas, evolução mensal e fluxo de caixa.
- A tela explica claramente o significado do modo selecionado.
- O motor já possuía testes cobrindo a diferença entre realizado e projetado.

## Integridade

O modo não altera nenhum lançamento. Ele apenas muda a população utilizada nos cálculos, mantendo a distinção entre fato financeiro e projeção.

Pagamentos de cartão continuam separados das despesas para evitar dupla contagem.

## Limitações

Testes, typecheck e build não foram executados devido à limitação anterior do registry npm (HTTP 403).

A revisão específica da Fase 08 — alocação de pagamentos às faturas e regras históricas dos cartões — continua pendente.
