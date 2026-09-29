# Fase 25 — Conflitos de sincronização

## Implementado

- conflito de versão agora gera uma interface explícita;
- o estado local continua preservado até o usuário decidir;
- estado remoto é buscado novamente para permitir comparação operacional;
- opção **Usar dados online** substitui o estado local pelo remoto;
- opção **Manter meus dados** tenta publicar o estado local usando a versão remota recém-confirmada;
- se houver nova alteração durante a resolução, o sistema não sobrescreve silenciosamente e informa que um novo conflito ocorreu;
- não existe mesclagem automática de transações financeiras.

## Integridade

A sincronização continua usando versionamento otimista.

Nenhum estado financeiro é mesclado campo a campo automaticamente, pois isso poderia produzir dupla contagem, transações duplicadas ou saldos incorretos.

A decisão de substituir o estado remoto é explícita.

## Limitações

Ainda não há uma visualização detalhada das diferenças entre os dois estados; a resolução é feita por estado completo.

Testes, typecheck e build continuam pendentes devido à limitação anterior do registry npm (HTTP 403).

A revisão específica da Fase 08 continua reservada para cartões/faturas.
