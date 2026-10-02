# Fase 13 — Relatórios

## Implementado
- Despesas por categoria.
- Receitas por categoria.
- Evolução mensal das despesas.
- Despesas por pessoa.
- Fluxo de caixa mensal.
- Filtro por mês.
- Tela dedicada de Relatórios na navegação mobile.

## Regras
- CANCELLED não entra nos relatórios de receitas/despesas.
- TRANSFER não é tratado como receita ou despesa.
- Compras no cartão são despesas pela data da compra, seguindo a regra do orçamento.
- Relatórios são derivados das transações; não criam nem alteram dados financeiros.

## Limitações
- Gráficos visuais avançados ainda não foram adicionados.
- Não há exportação de relatórios em PDF nesta fase.
- O fluxo de caixa apresentado é mensal e derivado dos lançamentos.

## Validação
Testes de domínio foram escritos. Vitest/typecheck/build permanecem pendentes por causa do bloqueio do registry npm (HTTP 403).
