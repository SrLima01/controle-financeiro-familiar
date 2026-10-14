import { describe, expect, it } from "vitest";
import { emptyEntityCollection, parseBackup, serializeBackup } from "./backup";

describe("backup", () => {
  it("round-trips a valid empty backup", () => {
    const parsed = parseBackup(serializeBackup(emptyEntityCollection()));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.data.transactions).toEqual([]);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseBackup("{")).toThrow();
  });

  it("rejects duplicate ids", () => {
    const data = emptyEntityCollection();
    data.people = [
      { id: "p1", name: "A", active: true },
      { id: "p1", name: "B", active: true }
    ];
    expect(() => parseBackup(serializeBackup(data))).toThrow(/Duplicate id/);
  });

  it("rejects a status incompatible with a transaction type", () => {
    const data = emptyEntityCollection();
    data.accounts = [{ id: "a1", name: "Conta", type: "CHECKING", openingBalanceCents: 0, active: true }];
    data.transactions = [{ id: "bad-status", date: "2026-10-01", type: "EXPENSE", status: "RECEIVED", amountCents: 1000, description: "Despesa inválida", accountId: "a1" }];
    expect(() => parseBackup(serializeBackup(data))).toThrow(/status incompatible with its type/);
  });

  it("rejects unknown card account", () => {
    const data = emptyEntityCollection();
    data.cards = [{
      id: "c1",
      name: "Card",
      accountId: "missing",
      creditLimitCents: 10000,
      closingDay: 10,
      dueDay: 20,
      active: true
    }];
    expect(() => parseBackup(serializeBackup(data))).toThrow(/Invalid card/);
  });
});
