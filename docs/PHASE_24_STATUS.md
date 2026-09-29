# Fase 24 — Navegação mobile

## Implementado

- navegação inferior passou a suportar as 6 áreas principais sem depender de uma grade de 5 colunas;
- cada item possui largura mínima e pode rolar horizontalmente em telas muito estreitas;
- preservado o acesso direto a Início, Contas, Lançamentos, Cartões, Relatórios e Mais;
- adicionados atributos de acessibilidade `aria-label` e `aria-current`;
- ícones decorativos marcados como conteúdo não semântico;
- respeitada a área segura inferior de aparelhos com gesture bar/notch;
- conteúdo principal recebe espaço adicional para não ficar encoberto pela navegação fixa.

## Integridade

Esta fase altera somente apresentação e navegação. Nenhuma regra financeira, entidade ou cálculo foi alterado.

## Limitações

Testes, typecheck e build continuam pendentes por causa da limitação anterior do registry npm (HTTP 403).

A revisão específica da Fase 08 — cartões, faturas e alocação de pagamentos — continua registrada para etapa posterior.
