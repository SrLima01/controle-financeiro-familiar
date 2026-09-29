import { describe, expect, it } from "vitest";
import { buildInstallmentSet, cancelInstallments, getInstallmentNumber } from "./installment-engine";
import type { EntityCollection } from "../../infrastructure/persistence/repository";

const base = {
  totalAmountCents: 10001,
  installmentCount: 3,
  firstDate: "2026-01-31",
  description: "Compra",
  status: "PLANNED" as const,
  accountId: "account-1"
};

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
    const data: EntityCollection = { people: [], categories: [], accounts: [{ id: "account-1", name: "Conta", type: "CHECKING" as const, openingBalanceCents: 0, active: true }], cards: [], transactions: created.transactions, installmentGroups: [created.group], recurringRules: [], pots: [], potMovements: [], budgets: [] };
    const next = cancelInstallments(data, created.group.id, created.transactions[1].id, "ONE");
    expect(next.transactions.map(t => t.status)).toEqual(["PLANNED", "CANCELLED", "PLANNED"]);
  });

  it("cancels the selected installment and all following", () => {
    const created = buildInstallmentSet(base);
    const data: EntityCollection = { people: [], categories: [], accounts: [{ id: "account-1", name: "Conta", type: "CHECKING" as const, openingBalanceCents: 0, active: true }], cards: [], transactions: created.transactions, installmentGroups: [created.group], recurringRules: [], pots: [], potMovements: [], budgets: [] };
    const next = cancelInstallments(data, created.group.id, created.transactions[1].id, "THIS_AND_FOLLOWING");
    expect(next.transactions.map(t => t.status)).toEqual(["PLANNED", "CANCELLED", "CANCELLED"]);
    expect(getInstallmentNumber(created.group, created.transactions[2].id)).toBe(3);
  });
});
