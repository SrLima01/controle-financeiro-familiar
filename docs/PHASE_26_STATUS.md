# Fase 26 — CI e QA técnico

## Objetivo

Transformar typecheck, lint, testes e build em verificações executadas automaticamente pelo GitHub Actions.

## Pipeline

A cada push nas branches do projeto e em Pull Requests para `main`:

1. instalar dependências;
2. executar `npm run typecheck`;
3. executar `npm run lint`;
4. executar `npm test`;
5. executar `npm run build`.

## Por que esta fase vem antes de novas funcionalidades

Até a fase 25, as verificações locais não puderam ser executadas porque o ambiente de desenvolvimento retornava HTTP 403 ao acessar o registry do npm. Portanto, não seria correto afirmar que o projeto estava compilando ou que os testes estavam passando.

A CI passa a executar as verificações em um ambiente controlado do GitHub. O resultado real de cada etapa será usado para corrigir os erros antes de considerar a base tecnicamente validada.

## Critério de conclusão

Esta fase só será considerada tecnicamente validada quando houver uma execução do workflow com:

- typecheck: sucesso;
- lint: sucesso;
- testes: sucesso;
- build: sucesso.

A criação do workflow, por si só, não significa que esses quatro itens já passaram.

## Próxima etapa

Depois da primeira execução da CI, corrigir os erros encontrados em uma sequência de commits pequena e rastreável. Só depois disso avançar para a revisão profunda da Fase 08 — cartões e faturas.
