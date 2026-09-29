# Fase 5 — Shell mobile e primeiro fluxo funcional

## Entregue
- Shell React responsivo, mobile-first, com navegação inferior.
- Autenticação Supabase quando configurado.
- Modo local-first continua funcional sem Supabase configurado.
- Seleção/criação/entrada em família.
- Dashboard com saldo real, saldo projetado e visão mensal.
- Cadastro de contas.
- Cadastro de lançamentos de receitas/despesas com status.
- Cadastro de cartões.
- Persistência em IndexedDB após cada alteração.
- Sincronização remota via RPC quando família e Supabase estão configurados.
- Conflitos remotos não são mesclados automaticamente.
- Estado remoto agora passa pelas mesmas invariantes de backup antes de entrar no estado local.

## Integridade
Os cálculos de saldo continuam centralizados no motor financeiro da Fase 2. A interface não implementa uma segunda regra de cálculo.

## Não incluído nesta fase
Parcelamentos, recorrências, envelopes, orçamentos, relatórios, OCR/voz e edição/exclusão avançada. Eles permanecem como próximas etapas e não são representados por botões falsos.

## Testes
Não foi possível executar npm install/typecheck/test/build no ambiente atual porque o acesso ao registry npm permanece bloqueado por HTTP 403. O código foi revisado estaticamente, mas a execução local ainda é necessária antes de considerar a fase pronta para merge.

## Riscos conhecidos
- A UI inicial ainda precisa de fluxos completos de edição/arquivamento.
- Cartão já pode ser cadastrado, mas compra/fatura/pagamento ainda serão implementados na etapa específica de cartões.
- O fluxo de conflito exige resolução explícita em fase posterior.
