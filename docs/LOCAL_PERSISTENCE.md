# Persistência local — Fase 3

A aplicação usa IndexedDB como armazenamento local-first. A camada de domínio não conhece IndexedDB.

## Repositório

`IndexedDbFinanceRepository` oferece leitura, gravação unitária, gravação em lote, substituição completa e limpeza.

As seis coleções persistidas nesta fase são: people, categories, accounts, cards, transactions e installmentGroups.

## Atomicidade

`replaceAll` usa uma única transação IndexedDB readwrite envolvendo todas as coleções. Se qualquer operação falhar, a transação é abortada e o estado anterior deve permanecer.

## Histórico

Registros não são fisicamente removidos pelos casos de uso. Arquivamento/cancelamento e eventual soft-delete preservam histórico.

## Backup

O backup JSON contém versão de schema, versão do aplicativo, data de exportação e as seis coleções. A importação valida o JSON, IDs únicos, relações entre entidades, valores monetários e invariantes do motor financeiro antes de substituir o banco.

## Evolução

Mudanças futuras de schema devem incrementar DB_VERSION e executar migração explícita no onupgradeneeded. Não alterar silenciosamente dados financeiros.
