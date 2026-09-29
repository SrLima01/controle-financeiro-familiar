# Fase 20 — Pessoas e atribuição familiar

## Objetivo

Formalizar a entidade Pessoa como cadastro operacional da família, permitindo atribuir lançamentos e alimentar os relatórios por pessoa sem alterar o histórico financeiro.

## Implementado

- cadastro de pessoas com nome normalizado;
- bloqueio de nomes ativos duplicados, sem apagar histórico;
- edição de pessoa;
- arquivamento em vez de exclusão;
- pessoas arquivadas deixam de aparecer nos novos lançamentos;
- lançamentos históricos continuam referenciando a pessoa arquivada;
- módulo Pessoas acessível em Mais;
- validação do cadastro no backup/importação;
- proteção adicional do motor de orçamento, passando o conjunto completo de dados para a validação;
- testes unitários do motor de pessoas.

## Integridade

A entidade Pessoa não movimenta dinheiro. Ela é uma dimensão de atribuição/relatório.

Arquivar uma pessoa não altera transações existentes e não recalcula valores. O vínculo histórico permanece por ID.

Não foi criado vínculo automático entre usuário autenticado do Supabase e Pessoa: são conceitos diferentes. O usuário da conta representa autenticação/família; Pessoa representa a quem um lançamento pode ser atribuído.

## Pendências

- definir, em fase posterior, se cada Pessoa deve receber permissões/identidade própria ou permanecer apenas como atribuição financeira;
- eventual divisão de responsabilidades/percentuais por lançamento;
- testes reais de build, typecheck e Vitest continuam pendentes enquanto o ambiente não consegue instalar dependências pelo npm.

## Validação

O código foi revisado estruturalmente. Os testes não foram executados porque o ambiente anterior apresentou HTTP 403 no registry npm.
