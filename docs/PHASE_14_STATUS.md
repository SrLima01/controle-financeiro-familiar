# Fase 14 — Configurações, backup e exportação

## Implementado
- Exportação completa em JSON com schema/versionamento.
- Importação de JSON com validação antes da substituição.
- Exportação dos lançamentos em CSV.
- Tela Configurações dentro de Mais.
- Ação para encerrar sessão.

## Integridade
O JSON é validado pelo motor de backup antes da importação. A persistência usa replaceAll, mantendo a substituição como uma operação única.

## Limitações
- Não há restauração seletiva por entidade.
- CSV é exportação de lançamentos, não formato de restauração.
- Conflitos de sincronização continuam seguindo a política local-first existente.

## Validação
Testes/typecheck/build ainda não foram executados devido ao bloqueio do registry npm (HTTP 403).
