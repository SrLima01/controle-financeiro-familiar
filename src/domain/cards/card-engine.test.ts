import { describe, expect, it } from "vitest";
import {
  calculateCardAvailableLimit,
  calculateCardOutstanding,
  calculateCardCreditBalance,
  validateCreditCardUpdate,
  getCardInvoice,
  invoiceClosingDate,
  invoiceDueDateFromClosing,
} from "./card-engine";
import type { CreditCard, Transaction } from "../types/entities";

const card: CreditCard = {
  id: "c1",
  name: "Visa",
  accountId: "a1",
  creditLimitCents: 100000,
  closingDay: 10,
  dueDay: 20,
  active: true,
};

const makeCardTransaction = (
  cardId: string,
  id: string,
  date: string,
  type: "EXPENSE" | "CARD_PAYMENT",
  amountCents: number,
  status: "PAID" | "PLANNED" = "PAID",
) => ({
  id,
  date,
  type,
  status,
  amountCents,
  description: id,
  creditCardId: cardId,
} as const);

describe("card engine", () => {
  it("locks invoice structure after card history exists", () => {
    const changed = { ...card, closingDay: 11 };
    const history: Transaction[] = [{ id: "1", date: "2026-09-11", type: "EXPENSE", status: "PAID", amountCents: 1000, description: "Compra", creditCardId: "c1" }];
    expect(() => validateCreditCardUpdate(card, changed, ["a1"], history)).toThrow("fechamento");
    expect(() => validateCreditCardUpdate(card, { ...card, dueDay: 21 }, ["a1"], history)).toThrow("vencimento");
    expect(() => validateCreditCardUpdate(card, { ...card, accountId: "a2" }, ["a2"], history)).toThrow("conta");
    expect(() => validateCreditCardUpdate(card, { ...card, name: "Visa novo", creditLimitCents: 120000 }, ["a1"], history)).not.toThrow();
  });

  it("handles closing day 31 across short months and leap years", () => {
    expect(invoiceClosingDate("2026-02-01", 31)).toBe("2026-02-28");
    expect(invoiceClosingDate("2026-02-28", 31)).toBe("2026-02-28");
    expect(invoiceClosingDate("2026-03-01", 31)).toBe("2026-03-31");
    expect(invoiceClosingDate("2028-02-01", 31)).toBe("2028-02-29");
    expect(invoiceClosingDate("2028-02-29", 31)).toBe("2028-02-29");
    expect(invoiceClosingDate("2028-03-01", 31)).toBe("2028-03-31");
  });

  it("clamps due day 31 to February and keeps the due month rule deterministic", () => {
    expect(invoiceDueDateFromClosing("2026-02-28", 10, 31)).toBe("2026-02-28");
    expect(invoiceDueDateFromClosing("2028-02-29", 10, 31)).toBe("2028-02-29");
    expect(invoiceDueDateFromClosing("2026-03-31", 31, 31)).toBe("2026-04-30");
    expect(invoiceDueDateFromClosing("2026-03-31", 10, 31)).toBe("2026-03-31");
  });

  it("includes the exact closing date and moves the next day to the next invoice", () => {
    expect(invoiceClosingDate("2026-09-10", 10)).toBe("2026-09-10");
    expect(invoiceClosingDate("2026-09-11", 10)).toBe("2026-10-10");
  });

  it("places purchases on the correct closing cycle", () => {
    expect(invoiceClosingDate("2026-09-10", 10)).toBe("2026-09-10");
    expect(invoiceClosingDate("2026-09-11", 10)).toBe("2026-10-10");
    expect(invoiceDueDateFromClosing("2026-09-10", 10, 20)).toBe("2026-09-20");

    const transactions: Transaction[] = [
      {
        id: "1",
        date: "2026-09-11",
        type: "EXPENSE",
        status: "PAID",
        amountCents: 25000,
        description: "Compra",
        creditCardId: "c1",
      },
    ];

    expect(getCardInvoice(card, transactions, "2026-09-12").purchaseTotalCents).toBe(25000);
  });

  it("counts invoice payments only after the invoice closes", () => {
    const transactions: Transaction[] = [
      {
        id: "purchase",
        date: "2026-09-11",
        type: "EXPENSE",
        status: "PAID",
        amountCents: 30000,
        description: "Compra",
        creditCardId: "c1",
      },
      {
        id: "previous-payment",
        date: "2026-09-06",
        type: "CARD_PAYMENT",
        status: "PAID",
        amountCents: 10000,
        description: "Pagamento fatura anterior",
        accountId: "a1",
        creditCardId: "c1",
      },
      {
        id: "current-payment",
        date: "2026-10-15",
        type: "CARD_PAYMENT",
        status: "PAID",
        amountCents: 15000,
        description: "Pagamento da fatura",
        accountId: "a1",
        creditCardId: "c1",
      },
    ];

    const invoice = getCardInvoice(card, transactions, "2026-10-10");
    expect(invoice.purchaseTotalCents).toBe(30000);
    expect(invoice.paymentTotalCents).toBe(15000);
    expect(invoice.openAmountCents).toBe(15000);
  });

  it("counts a payment made exactly on the invoice due date", () => {
    const transactions = [
      makeCardTransaction(card.id, "purchase-1", "2026-09-05", "EXPENSE", 5000),
      makeCardTransaction(card.id, "payment-1", "2026-09-20", "CARD_PAYMENT", 5000),
    ];

    expect(getCardInvoice(card, transactions, "2026-09-10")).toMatchObject({
      dueDate: "2026-09-20",
      purchaseTotalCents: 5000,
      paymentTotalCents: 5000,
      openAmountCents: 0,
    });
  });

  it("applies a payment made before closing to an already-realized purchase", () => {
    const transactions = [
      makeCardTransaction(card.id, "purchase-1", "2026-09-05", "EXPENSE", 5000),
      makeCardTransaction(card.id, "payment-1", "2026-09-08", "CARD_PAYMENT", 2000),
    ];

    expect(getCardInvoice(card, transactions, "2026-09-10")).toMatchObject({
      purchaseTotalCents: 5000,
      paymentTotalCents: 2000,
      openAmountCents: 3000,
    });
    expect(calculateCardOutstanding(card, transactions)).toBe(3000);
  });

  it("allows a late payment to settle an already-realized older invoice", () => {
    const transactions = [
      makeCardTransaction(card.id, "purchase-1", "2026-09-05", "EXPENSE", 5000),
      makeCardTransaction(card.id, "payment-1", "2026-10-25", "CARD_PAYMENT", 5000),
    ];

    expect(calculateCardOutstanding(card, transactions)).toBe(0);
  });

  it("does not restore limit for pending card payments or planned purchases", () => {
    const transactions: Transaction[] = [
      {
        id: "purchase",
        date: "2026-09-05",
        type: "EXPENSE",
        status: "PAID",
        amountCents: 30000,
        description: "Compra",
        creditCardId: "c1",
      },
      {
        id: "planned",
        date: "2026-10-01",
        type: "EXPENSE",
        status: "PLANNED",
        amountCents: 20000,
        description: "Compra planejada",
        creditCardId: "c1",
      },
      {
        id: "pending-payment",
        date: "2026-09-15",
        type: "CARD_PAYMENT",
        status: "PENDING",
        amountCents: 10000,
        description: "Pagamento pendente",
        accountId: "a1",
        creditCardId: "c1",
      },
    ];

    expect(calculateCardOutstanding(card, transactions)).toBe(30000);
    expect(calculateCardAvailableLimit(card, transactions)).toBe(70000);
  });

  it("calculates outstanding and available limit from realized purchases and payments", () => {
    const transactions: Transaction[] = [
      {
        id: "1",
        date: "2026-09-05",
        type: "EXPENSE",
        status: "PAID",
        amountCents: 30000,
        description: "Compra",
        creditCardId: "c1",
      },
      {
        id: "2",
        date: "2026-09-06",
        type: "CARD_PAYMENT",
        status: "PAID",
        amountCents: 10000,
        description: "Pagamento",
        accountId: "a1",
        creditCardId: "c1",
      },
    ];

    expect(calculateCardOutstanding(card, transactions)).toBe(20000);
    expect(calculateCardAvailableLimit(card, transactions)).toBe(80000);
  });

  it("keeps an excess payment as card credit and restores available limit", () => {
    const transactions = [
      makeCardTransaction(card.id, "purchase-1", "2026-09-05", "EXPENSE", 10000),
      makeCardTransaction(card.id, "payment-1", "2026-09-20", "CARD_PAYMENT", 20000),
    ];

    expect(calculateCardOutstanding(card, transactions)).toBe(0);
    expect(calculateCardCreditBalance(card, transactions)).toBe(10000);
    expect(calculateCardAvailableLimit(card, transactions)).toBe(110000);
  });

  it("does not produce a negative invoice balance after overpayment", () => {
    const transactions: Transaction[] = [
      {
        id: "1",
        date: "2026-09-11",
        type: "EXPENSE",
        status: "PAID",
        amountCents: 10000,
        description: "Compra",
        creditCardId: "c1",
      },
      {
        id: "2",
        date: "2026-10-15",
        type: "CARD_PAYMENT",
        status: "PAID",
        amountCents: 20000,
        description: "Pagamento",
        accountId: "a1",
        creditCardId: "c1",
      },
    ];

    expect(getCardInvoice(card, transactions, "2026-10-10").openAmountCents).toBe(0);
  });
});

describe("card payment allocation", () => {
  const card = {
    id: "card-1",
    name: "Cartão",
    accountId: "account-1",
    creditLimitCents: 100000,
    closingDay: 10,
    dueDay: 20,
    active: true,
  } as const;

  const tx = (
    id: string,
    date: string,
    type: "EXPENSE" | "CARD_PAYMENT",
    amountCents: number,
    status: "PAID" | "PLANNED" = "PAID",
  ) => makeCardTransaction(card.id, id, date, type, amountCents, status);

  it("allocates a late payment to the oldest open invoice", () => {
    const transactions = [
      tx("purchase-1", "2026-08-05", "EXPENSE", 3000),
      tx("purchase-2", "2026-09-05", "EXPENSE", 5000),
      tx("payment-1", "2026-09-25", "CARD_PAYMENT", 4000),
    ];
    expect(getCardInvoice(card, transactions, "2026-08-10")).toMatchObject({
      purchaseTotalCents: 3000,
      paymentTotalCents: 3000,
      openAmountCents: 0,
    });
    expect(getCardInvoice(card, transactions, "2026-09-10")).toMatchObject({
      purchaseTotalCents: 5000,
      paymentTotalCents: 1000,
      openAmountCents: 4000,
    });
    expect(calculateCardOutstanding(card, transactions)).toBe(4000);
  });

  it("keeps an advance payment as card credit until a purchase exists", () => {
    const transactions = [
      tx("payment-1", "2026-09-05", "CARD_PAYMENT", 5000),
      tx("purchase-1", "2026-09-15", "EXPENSE", 5000),
    ];

    expect(calculateCardCreditBalance(card, transactions)).toBe(5000);
    expect(calculateCardOutstanding(card, transactions)).toBe(5000);
    expect(calculateCardAvailableLimit(card, transactions)).toBe(100000);
  });

  it("does not use an advance payment to reduce a future invoice", () => {
    const transactions = [
      tx("purchase-1", "2026-09-15", "EXPENSE", 5000),
      tx("payment-1", "2026-09-05", "CARD_PAYMENT", 5000),
    ];
    expect(getCardInvoice(card, transactions, "2026-09-10")).toMatchObject({
      purchaseTotalCents: 0,
      paymentTotalCents: 0,
      openAmountCents: 0,
    });
    expect(calculateCardOutstanding(card, transactions)).toBe(5000);
  });

  it("ignores planned purchases and payments that are not realized", () => {
    const transactions = [
      tx("purchase-1", "2026-09-05", "EXPENSE", 5000, "PLANNED"),
      tx("payment-1", "2026-09-15", "CARD_PAYMENT", 5000, "PLANNED"),
    ];
    expect(calculateCardOutstanding(card, transactions)).toBe(0);
  });
});
