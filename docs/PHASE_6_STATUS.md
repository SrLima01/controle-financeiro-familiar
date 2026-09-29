# Fase 6 — Contas

## Implementado

- Cadastro real de contas no IndexedDB.
- Edição de nome, tipo e saldo inicial.
- Valores monetários convertidos para centavos e validados com `assertCents`.
- Arquivamento em vez de exclusão, preservando o histórico.
- Saldo exibido usando o motor financeiro existente.
- Persistência local atômica via `replaceAll`.
- Envio para Supabase usando controle otimista de versão.
- Em conflito, a alteração local permanece salva, mas não é enviada silenciosamente.

## Tipos suportados

CHECKING, SAVINGS, DIGITAL, CASH e INVESTMENT.

## Decisão de integridade

A tela não calcula saldo por conta própria. Ela chama `calculateProjectedAccountBalance`, portanto transferências, despesas, receitas e pagamentos de cartão continuam sujeitos às regras do motor financeiro.

## Pendente

- impedir/avisar alterações de saldo inicial quando já existirem lançamentos, se essa regra for definida como imutável;
- criar fluxo de transações;
- sincronização visual com estados Local/Sincronizando/Sincronizado/Conflito;
- testes de integração de UI quando o ambiente npm estiver disponível.

## Testes

Não executados neste ambiente porque o registry npm permanece bloqueado por HTTP 403.
