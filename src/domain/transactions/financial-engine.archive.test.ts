import { describe, expect, it } from "vitest";
import { validateAccountArchive } from "./financial-engine";
import type { Account, CreditCard, Transaction } from "../types/entities";

const account: Account = { id: "a1", name: "Conta principal", type: "CHECKING", openingBalanceCents: 10000, active: true };
const zeroBalanceAccount: Account = { ...account, openingBalanceCents: 0 };
const card: CreditCard = { id: "c1", name: "Cartão", accountId: "a1", creditLimitCents: 100000, closingDay: 10, dueDay: 20, active: true };

describe("safe account archiving", () => {
  it("blocks archiving when the real balance is not zero", () => {
    expect(() => validateAccountArchive(account, { accounts: [account], transactions: [] }, [])).toThrow("saldo real para zero");
  });

  it("allows archiving when the real balance is zero and there are no active links", () => {
    const expense: Transaction = { id: "t1", date: "2026-10-01", type: "EXPENSE", status: "PAID", amountCents: 10000, description: "Saída final", accountId: "a1" };
    expect(() => validateAccountArchive(account, { accounts: [account], transactions: [expense] }, [])).not.toThrow();
  });

  it("blocks archiving while an active card is linked", () => {
    expect(() => validateAccountArchive(zeroBalanceAccount, { accounts: [zeroBalanceAccount], cards: [card], transactions: [] }, [])).toThrow("cartão ativo vinculado");
  });

  it("blocks archiving while pending or planned movements remain", () => {
    const pending: Transaction = { id: "t2", date: "2026-10-20", type: "EXPENSE", status: "PLANNED", amountCents: 1000, description: "Conta futura", accountId: "a1" };
    expect(() => validateAccountArchive(zeroBalanceAccount, { accounts: [zeroBalanceAccount], transactions: [pending] }, [])).toThrow("movimentações pendentes/planejadas");
  });

  it("blocks archiving while an active recurring rule is linked", () => {
    expect(() => validateAccountArchive(zeroBalanceAccount, { accounts: [zeroBalanceAccount], transactions: [] }, [{ active: true, accountId: "a1" }])).toThrow("recorrência ativa");
  });
});
