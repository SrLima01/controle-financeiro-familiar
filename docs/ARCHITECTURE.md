# Arquitetura
React + TypeScript + Vite. O domínio financeiro não depende de UI, IndexedDB, Supabase ou APIs externas.
Princípios: centavos inteiros; datas financeiras YYYY-MM-DD; motor determinístico; separação entre domínio e infraestrutura; cartão não reduz banco na compra; pagamento de cartão não cria nova despesa; transferências não alteram patrimônio total; histórico preservado.
Camadas futuras: domain, application, infrastructure, ui.