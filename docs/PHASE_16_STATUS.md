# Fase 16 — Entrada Inteligente

## Implementado
- parser determinístico local para linguagem natural;
- reconhecimento de valor em formatos brasileiros, incluindo `12.34`, `150,50` e `1.250,50`;
- reconhecimento de hoje, ontem, anteontem e datas `dd/mm/aaaa`;
- identificação de entrada, saída, transferência e pagamento de cartão;
- correspondência de categorias, contas e cartões existentes;
- geração de rascunho de revisão, sem persistência automática;
- edição dos campos antes da confirmação;
- confirmação usa o mesmo `validateTransaction` dos lançamentos manuais;
- teste unitário do parser;
- preparação da mesma camada para futura entrada por voz.

## Regra de segurança
Interpretar não grava nada. O usuário precisa revisar e tocar em **Confirmar lançamento**.

Quando a origem/destino ou outro campo financeiro obrigatório não puder ser determinado com segurança, o parser deixa o campo pendente para seleção manual.

## Limitações
- o parser é determinístico e não é um modelo de linguagem;
- sinônimos complexos podem exigir edição manual;
- OCR de recibos fica para uma fase posterior;
- reconhecimento de voz fica como camada de entrada sobre o mesmo fluxo de revisão;
- testes/typecheck/build continuam pendentes enquanto o registry npm retorna HTTP 403.

## Integridade
Não há novo motor financeiro. O lançamento confirmado passa pelo motor financeiro existente e pela persistência atômica/local-first.
