# Status do projeto

## Estado atual

O projeto está em fase de consolidação e QA para a versão 1.0.

### Concluído

- Fundação React + TypeScript + Vite.
- Domínio financeiro com valores monetários em centavos.
- Datas financeiras determinísticas.
- Motor financeiro e validações transversais.
- Persistência local com IndexedDB e operações atômicas.
- Backup/restore e exportações.
- Supabase, autenticação, família e sincronização.
- Tratamento explícito de conflitos de sincronização.
- Shell mobile/PWA e navegação responsiva.
- Contas.
- Transações.
- Cartões e faturas.
- Parcelamentos.
- Recorrências.
- Cofrinhos.
- Orçamentos.
- Relatórios.
- Pessoas e categorias.
- Assistente financeiro determinístico.
- Entrada inteligente.
- OCR local de recibos.
- Entrada por voz.
- CI com typecheck, lint, testes e build.
- Auditoria adicional de cartões/faturas:
  - fechamento e vencimento;
  - pagamentos parciais;
  - pagamentos antecipados;
  - pagamentos atrasados;
  - crédito a favor;
  - parcelas;
  - cancelamentos;
  - vínculo cartão/conta;
  - integração com fluxo de caixa, relatórios e orçamento.

## Última validação

O último commit validado pelo CI nesta linha de trabalho é:

- `af1a3a3fc97ac1cb95747742ed63be2ccce6977e`
- CI: concluído com sucesso.

## Próximas etapas

1. Consolidar as fases aprovadas em uma linha estável.
2. QA funcional completo.
3. Revisão final de UX/UI mobile.
4. Auditoria final de segurança e Supabase.
5. Build/deploy de produção.
6. Teste real em dois aparelhos.
7. Correções finais e preparação da versão 1.0.

## Regra de trabalho

Nenhuma alteração financeira deve ser considerada concluída sem:

- testes automatizados relevantes;
- typecheck;
- lint;
- build;
- CI verde;
- revisão do impacto sobre saldo, fluxo de caixa, cartões, orçamento e relatórios quando aplicável.

O PR da auditoria de cartões permanece aberto e em draft até a consolidação planejada.
