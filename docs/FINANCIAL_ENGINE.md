# Motor financeiro
Saldo real = somente PAID/RECEIVED. Saldo projetado = todo movimento não CANCELLED.
INCOME entra em conta. EXPENSE sai de conta; despesa de cartão usa somente creditCardId. TRANSFER sai da origem e entra no destino. CARD_PAYMENT sai da conta bancária e não é despesa adicional. Parcelas distribuem centavos deterministicamente.
Faturas, fechamento/vencimento, limite disponível e alocação de pagamentos serão tratados em fase própria.