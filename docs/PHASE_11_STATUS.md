# Fase 11 — Caixinhas / Reservas

## Implementado
- Entidade `Pot` para representar uma reserva lógica.
- Entidade `PotMovement` para depósitos e resgates.
- Saldo da caixinha é sempre derivado dos movimentos.
- Meta financeira opcional por caixinha.
- Cálculo de:
  - saldo reservado;
  - total reservado;
  - dinheiro livre = saldo real das contas - reservas ativas.
- Depósito bloqueado quando excede o dinheiro livre disponível.
- Resgate bloqueado quando excede o saldo da caixinha.
- Arquivamento preserva os movimentos históricos.
- IndexedDB atualizado para DB_VERSION 3.
- Backups/estados anteriores à Fase 11 recebem coleções vazias de caixinhas.
- Interface mobile integrada em "Mais", junto das Recorrências.

## Integridade financeira
Uma caixinha **não é uma nova conta bancária** e não reduz novamente o saldo da conta.

Exemplo:
- saldo real das contas: R$ 5.000;
- reserva para obra: R$ 1.200;
- dinheiro livre: R$ 3.800.

O R$ 1.200 continua incluído no patrimônio/saldo real, mas fica separado logicamente para não ser tratado como dinheiro disponível.

## Limitações deliberadas
- Não existe transferência bancária física automática ao depositar na caixinha.
- Não há rendimento de caixinha/investimento.
- Não há histórico de auditoria específico além dos movimentos persistidos.
- Uma caixinha arquivada não participa do dinheiro livre atual.

## Validação
Os testes de domínio foram escritos, mas npm/Vitest, typecheck e build continuam pendentes devido ao bloqueio do registry npm (HTTP 403).
