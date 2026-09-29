# Fase 21 — Categorias

## Objetivo
Formalizar o cadastro de categorias para impedir duplicidades e preservar histórico.

## Implementado
- criar categorias de receita e despesa;
- normalização de nomes;
- bloqueio de duplicidade entre categorias ativas do mesmo tipo;
- mesmo nome pode existir em Receita e Despesa, pois representam naturezas diferentes;
- edição;
- arquivamento sem exclusão;
- categorias arquivadas deixam de aparecer em novos lançamentos;
- validação de unicidade no backup/importação;
- tela de Categorias no menu Mais;
- testes unitários do motor.

## Integridade
Arquivar categoria não altera lançamentos históricos. A categoria continua referenciada pelo ID e pode aparecer nos relatórios históricos.

Não foi criado mecanismo para excluir categoria, justamente para evitar quebrar referências financeiras.

## Validação
Testes, typecheck e build continuam pendentes devido à limitação anterior do registry npm (HTTP 403).
