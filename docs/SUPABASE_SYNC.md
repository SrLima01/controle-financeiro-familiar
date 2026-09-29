# Fase 4 — Supabase, autenticação e sincronização

## Segurança

O cliente usa apenas a URL pública do projeto e uma publishable key. Nenhuma service_role key deve entrar no frontend.

O banco usa RLS em `families`, `family_members` e `finance_state`.

A autorização de acesso ao estado financeiro é baseada no membership persistido em `family_members`, não em dados editáveis pelo usuário.

## Família

- `create_family`: cria família, adiciona o criador como owner e cria o estado financeiro inicial.
- `join_family`: entra usando código de convite.
- `listMyFamilies`: lista somente famílias que o usuário pode enxergar pelas policies.

## Sincronização

O servidor mantém um único agregado `finance_state` por família nesta fase.

Fluxo local-first:

1. O aplicativo trabalha primeiro no IndexedDB.
2. Ao autenticar/entrar em uma família, faz pull do estado remoto.
3. Alterações locais podem ser enviadas com a versão remota conhecida.
4. O RPC `save_finance_state` executa update condicional por `family_id + version`.
5. Se a versão já mudou, o servidor rejeita com `sync_conflict`.
6. O cliente não sobrescreve silenciosamente o estado remoto; retorna conflito para uma etapa posterior de resolução explícita.

## Concorrência

A versão remota é monotônica. O cliente deve persistir a última versão conhecida junto do contexto de sincronização e nunca assumir que um push concorrente foi aceito.

## Limite desta fase

Ainda não existe merge automático por entidade/campo. Isso é deliberado: merge financeiro automático sem regras determinísticas pode causar perda ou duplicação de movimentações.

## Segurança verificada

Foi corrigida uma policy de leitura de `family_members` que continha uma condição tautológica e poderia quebrar o isolamento esperado.

Também foi criada uma função interna `is_family_member(uuid)` para evitar recursão de RLS.

As RPCs `SECURITY DEFINER` continuam disponíveis para usuários autenticados porque são necessárias ao fluxo de criação/entrada/salvamento e fazem suas próprias verificações de autenticação/membership. O papel `anon` não pode executá-las.

O Security Advisor ainda pode reportar o aviso genérico de `SECURITY DEFINER` executável por `authenticated`; neste projeto isso é intencional e as funções são explicitamente limitadas e verificadas.

## Validação pendente

O código frontend ainda depende da instalação do pacote `@supabase/supabase-js` e de execução real de typecheck/test/build.
