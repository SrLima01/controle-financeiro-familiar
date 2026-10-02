# Fase 15 — Assistente financeiro

## Implementado
- Motor determinístico de análise mensal.
- Resultado realizado separado de movimentos pendentes/futuros.
- Identificação de resultado mensal.
- Alertas de orçamento em 80%+ e acima de 100%.
- Identificação da maior categoria de despesa.
- Resumo de movimentos pendentes/futuros.
- Tela Assistente dentro de Mais.

## Segurança financeira
O assistente é somente leitura nesta fase. Ele não cria, edita, cancela ou movimenta valores. Toda análise usa os dados locais existentes.

## Limitações
- Não há IA generativa nem envio de dados financeiros para serviço externo.
- Interpretação de linguagem natural e voz ficam para uma etapa posterior.
- Recomendações financeiras personalizadas não são executadas automaticamente.

## Validação
Teste unitário do motor foi criado. Execução de Vitest/typecheck/build continua pendente por bloqueio do registry npm (HTTP 403).
