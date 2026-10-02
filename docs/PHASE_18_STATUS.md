# Fase 18 — Entrada por voz

## Implementado
- botão de entrada por voz na Entrada Inteligente;
- Web Speech API com idioma `pt-BR`;
- resultado da fala alimenta o mesmo campo de texto do parser;
- interpretação continua determinística e local;
- revisão continua obrigatória antes de qualquer persistência;
- fallback claro para navegadores sem suporte;
- possibilidade de interromper a gravação.

## Fluxo
Fala → texto → parser inteligente → revisão → validação financeira → confirmação → persistência.

A voz não possui caminho separado para gravar diretamente uma transação.

## Privacidade
A aplicação usa a API de reconhecimento de fala disponível no navegador. O comportamento de processamento/transmissão da fala pode variar conforme o navegador e o sistema operacional; portanto, esta fase não promete processamento exclusivamente local da voz.

## Limitações
- suporte depende do navegador/dispositivo;
- qualidade varia com ruído, microfone e pronúncia;
- não há wake word;
- não há escuta contínua;
- typecheck/test/build permanecem pendentes por causa do bloqueio HTTP 403 do registry npm.
