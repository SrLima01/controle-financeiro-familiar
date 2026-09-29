import { describe, expect, it } from "vitest";
import {
  calculateCardAvailableLimit,
  calculateCardOutstanding,
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

describe("card engine", () => {
  it("places purchases on the correct closing cycle", () => {
    expect(invoiceClosingDate("2026-09-10", 10)).toBe("2026-09-10");
    expect(invoiceClosingDate("2026-09-11", 10)).toBe("2026-10-10");
    expect(invoiceDueDateFromClosing("2026-09-10", 10, 20)).toBe("2026-09-20");

    const tx: Transaction[] = [
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

    expect(getCardInvoice(card, tx, "2026-09-12").purchaseTotalCents).toBe(25000);
  });

  it("counts invoice payments only after the invoice closes", () => {
    const tx: Transaction[] = [
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
        date: "2026-09-15",
        type: "CARD_PAYMENT",
        status: "PAID",
        amountCents: 15000,
        description: "Pagamento da fatura",
        accountId: "a1",
        creditCardId: "c1",
      },
    ];

    const invoice = getCardInvoice(card, tx, "2026-09-12");
    expect(invoice.purchaseTotalCents).toBe(25000);
    expect(invoice.paymentTotalCents).toBe(15000);
    expect(invoice.openAmountCents).toBe(10000);
  });

  it("does not restore limit for pending card payments or planned purchases", () => {
    const tx: Transaction[] = [
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

    expect(calculateCardOutstanding(card, tx)).toBe(30000);
    expect(calculateCardAvailableLimit(card, tx)).toBe(70000);
  });

  it("calculates outstanding and available limit from realized purchases and payments", () => {
    const tx: Transaction[] = [
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

    expect(calculateCardOutstanding(card, tx)).toBe(20000);
    expect(calculateCardAvailableLimit(card, tx)).toBe(80000);
  });

  it("does not produce a negative invoice balance after overpayment", () => {
    const tx: Transaction[] = [
      {
        id: "1",
        date: "2026-09-05",
        type: "EXPENSE",
        status: "PAID",
        amountCents: 10000,
        description: "Compra",
        creditCardId: "c1",
      },
      {
        id: "2",
        date: "2026-09-15",
        type: "CARD_PAYMENT",
        status: "PAID",
        amountCents: 20000,
        description: "Pagamento",
        accountId: "a1",
        creditCardId: "c1",
      },
    ];

    expect(getCardInvoice(card, tx, "2026-09-12").openAmountCents).toBe(0);
  });
});
