import { describe, expect, it } from "vitest";
import { buildInstallmentSet, cancelInstallments, getInstallmentNumber } from "./installment-engine";
import type { EntityCollection } from "../../infrastructure/persistence/repository";
import { calculateCardOutstanding, getCardInvoice } from "../cards/card-engine";

const base = {
  totalAmountCents: 10001,
  installmentCount: 3,
  firstDate: "2026-01-31",
  description: "Compra",
  status: "PLANNED" as const,
  accountId: "account-1"
};

const card = {
  id: "card-1",
  name: "Cartão",
  accountId: "account-1",
  creditLimitCents: 100000,
  closingDay: 10,
  dueDay: 20,
  active: true
} as const;

const makeData = (transactions: EntityCollection["transactions"], installmentGroups: EntityCollection["installmentGroups"]): EntityCollection => ({
  people: [],
  categories: [],
  accounts: [{ id: "account-1", name: "Conta", type: "CHECKING", openingBalanceCents: 0, active: true }],
  cards: [card],
  transactions,
  installmentGroups,
  recurringRules: [],
  pots: [],
  potMovements: [],
  budgets: []
});

describe("installment engine", () => {
  it("creates linked installments with remainder in the first installment", () => {
    const result = buildInstallmentSet(base);
    expect(result.transactions.map(t => t.amountCents)).toEqual([3334, 3334, 3333]);
    expect(result.transactions.map(t => t.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(result.transactions.every(t => t.installmentGroupId === result.group.id)).toBe(true);
    expect(result.group.transactionIds).toEqual(result.transactions.map(t => t.id));
  });

  it("rejects a one-installment parcelamento", () => {
    expect(() => buildInstallmentSet({ ...base, installmentCount: 1 })).toThrow();
  });

  it("cancels only the selected installment", () => {
    const created = buildInstallmentSet(base);
    const next = cancelInstallments(
      makeData(created.transactions, [created.group]),
      created.group.id,
      created.transactions[1].id,
      "ONE"
    );
    expect(next.transactions.map(t => t.status)).toEqual(["PLANNED", "CANCELLED", "PLANNED"]);
  });

  it("cancels the selected installment and all following", () => {
    const created = buildInstallmentSet(base);
    const next = cancelInstallments(
      makeData(created.transactions, [created.group]),
      created.group.id,
      created.transactions[1].id,
      "THIS_AND_FOLLOWING"
    );
    expect(next.transactions.map(t => t.status)).toEqual(["PLANNED", "CANCELLED", "CANCELLED"]);
    expect(getInstallmentNumber(created.group, created.transactions[2].id)).toBe(3);
  });

  it("builds card installments across invoices with correct dates and amounts", () => {
    const result = buildInstallmentSet({
      totalAmountCents: 10001,
      installmentCount: 3,
      firstDate: "2026-01-31",
      description: "Compra no cartão",
      status: "PAID",
      creditCardId: card.id
    });

    expect(result.transactions.map(t => t.amountCents)).toEqual([3334, 3334, 3333]);
    expect(result.transactions.map(t => t.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31"
    ]);
    expect(result.transactions.every(t => t.creditCardId === card.id)).toBe(true);
    expect(result.transactions.every(t => !t.accountId)).toBe(true);

    expect(getCardInvoice(card, result.transactions, "2026-02-05")).toMatchObject({
      closingDate: "2026-02-10",
      purchaseTotalCents: 3334
    });
    expect(getCardInvoice(card, result.transactions, "2026-03-05")).toMatchObject({
      closingDate: "2026-03-10",
      purchaseTotalCents: 3334
    });
  });

  it("keeps future card installments out of realized limit until they are paid", () => {
    const result = buildInstallmentSet({
      totalAmountCents: 30000,
      installmentCount: 3,
      firstDate: "2026-09-05",
      description: "Compra parcelada",
      status: "PLANNED",
      creditCardId: card.id
    });

    expect(calculateCardOutstanding(card, result.transactions)).toBe(0);

    const paidFirst = result.transactions.map((tx, index) =>
      index === 0 ? { ...tx, status: "PAID" as const } : tx
    );
    expect(calculateCardOutstanding(card, paidFirst)).toBe(10000);
    expect(getCardInvoice(card, paidFirst, "2026-09-10")).toMatchObject({
      purchaseTotalCents: 10000,
      openAmountCents: 10000
    });
  });

  it("cancelling one realized card installment removes only that installment from outstanding", () => {
    const result = buildInstallmentSet({
      totalAmountCents: 30000,
      installmentCount: 3,
      firstDate: "2026-09-05",
      description: "Compra parcelada",
      status: "PAID",
      creditCardId: card.id
    });
    const next = cancelInstallments(
      makeData(result.transactions, [result.group]),
      result.group.id,
      result.transactions[1].id,
      "ONE"
    );

    expect(next.transactions.map(t => t.status)).toEqual(["PAID", "CANCELLED", "PAID"]);
    expect(calculateCardOutstanding(card, next.transactions)).toBe(20000);
  });

  it("cancelling this and following leaves previous realized card installments intact", () => {
    const result = buildInstallmentSet({
      totalAmountCents: 40000,
      installmentCount: 4,
      firstDate: "2026-09-05",
      description: "Compra parcelada",
      status: "PAID",
      creditCardId: card.id
    });
    const next = cancelInstallments(
      makeData(result.transactions, [result.group]),
      result.group.id,
      result.transactions[1].id,
      "THIS_AND_FOLLOWING"
    );

    expect(next.transactions.map(t => t.status)).toEqual([
      "PAID",
      "CANCELLED",
      "CANCELLED",
      "CANCELLED"
    ]);
    expect(calculateCardOutstanding(card, next.transactions)).toBe(10000);
  });

  it("rejects a parcelamento that tries to use account and card together", () => {
    expect(() =>
      buildInstallmentSet({
        ...base,
        accountId: "account-1",
        creditCardId: card.id
      })
    ).toThrow("conta ou cartão");
  });
});
