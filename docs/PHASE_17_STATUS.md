# Fase 17 — OCR de recibos

## Implementado
- captura de imagem pelo celular usando `input type=file` com câmera;
- OCR local com Tesseract.js em português;
- extração conservadora do total somente em linhas com marcadores como TOTAL;
- extração de data;
- sugestão de estabelecimento;
- tela de revisão obrigatória;
- seleção manual de categoria, conta ou cartão;
- texto bruto do OCR disponível para conferência;
- confirmação passa pelo mesmo `validateTransaction` dos lançamentos manuais;
- testes unitários das funções de extração.

## Segurança financeira
O OCR não cria lançamento diretamente. Mesmo que a leitura tenha alta confiança, o aplicativo exige revisão e confirmação explícita.

A confiança do OCR mede a qualidade estimada da leitura do texto; ela não significa que valor, data, estabelecimento ou categoria estejam corretos.

## Privacidade
O desenho desta fase usa OCR executado no dispositivo através do Tesseract.js, sem enviar o recibo para um serviço externo próprio do aplicativo.

## Limitações
- recibos amassados, desfocados ou com layout incomum podem produzir OCR incorreto;
- identificação de estabelecimento é apenas uma sugestão;
- itens do recibo ainda não são convertidos em lançamentos individuais;
- não há integração específica com NFC-e/SAT/QR Code;
- typecheck/test/build continuam pendentes enquanto o registry npm disponível retorna HTTP 403.
