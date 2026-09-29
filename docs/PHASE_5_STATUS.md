# Fase 5 — Shell mobile, autenticação e família

## Implementado

- Shell React mobile-first com navegação inferior.
- Autenticação por e-mail/senha usando Supabase Auth.
- Seleção de família, criação de família e entrada por código.
- Carregamento local inicial via IndexedDB.
- Pull remoto após o carregamento local; estado remoto validado pelas mesmas invariantes do backup.
- Dashboard inicial calculado pelo motor financeiro existente:
  - saldo total real;
  - saldo projetado;
  - impacto de movimentos pendentes;
  - contas ativas.
- Rotas visuais para Contas, Transações, Cartões e Mais sem ações financeiras falsas.

## Integridade

A interface não calcula regras financeiras próprias. O Dashboard chama o motor financeiro determinístico.

O estado remoto agora passa por `validateBackup` antes de ser aceito localmente. Um payload remoto inválido não sobrescreve o estado local.

Não há merge automático de conflitos.

## Testes

Os testes, typecheck, lint e build continuam pendentes de execução no ambiente de desenvolvimento porque o acesso ao registry npm permanece bloqueado por HTTP 403.

## Riscos / próximos passos

1. Persistir a família selecionada localmente para reabertura direta do app.
2. Implementar criação/edição/arquivamento real de contas.
3. Implementar lançamento de transações conectado ao motor e persistência.
4. Implementar cartões, faturas e pagamentos.
5. Implementar recorrências, parcelas, caixinhas e orçamentos.
6. Implementar relatórios e assistente.
7. Adicionar testes de integração de UI e fluxo offline/online.
