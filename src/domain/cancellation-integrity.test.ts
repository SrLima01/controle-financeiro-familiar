import { describe, expect, it } from "vitest";
import type { EntityCollection } from "../infrastructure/persistence/repository";
import { calculateAccountBalance, calculateProjectedAccountBalance } from "./transactions/financial-engine";
import { calculateCardOutstanding, getCardInvoice } from "./cards/card-engine";
import { cancelInstallments, buildInstallmentSet } from "./installments/installment-engine";
import { createRecurringRule, deactivateRecurringRule, generateRecurringTransactions } from "./recurring/recurring-engine";
import { cashFlow, expensesByCategory } from "./reports/report-engine";
import { getBudgetSpent } from "./budgets/budget-engine";

const account = {
  id: "account-1",
  name: "Conta",
  type: "CHECKING" as const,
  openingBalanceCents: 100000,
  active: true
};

const card = {
  id: "card-1",
  name: "Cartão",
  accountId: account.id,
  creditLimitCents: 100000,
  closingDay: 10,
  dueDay: 20,
  active: true
};

const category = {
  id: "category-1",
  name: "Mercado",
  kind: "EXPENSE" as const,
  active: true
};

function data(transactions: EntityCollection["transactions"]): EntityCollection {
  return {
    people: [],
    categories: [category],
    accounts: [account],
    cards: [card],
    transactions,
    installmentGroups: [],
    recurringRules: [],
    pots: [],
    potMovements: [],
    budgets: [{ id: "budget-1", month: "2026-09", categoryId: category.id, limitCents: 50000, active: true }]
  };
}

describe("cancellation integrity", () => {
  it("removes a cancelled bank expense from real/projected balance and reports", () => {
    const transactions = [{
      id: "expense-1",
      date: "2026-09-15",
      type: "EXPENSE" as const,
      status: "CANCELLED" as const,
      amountCents: 10000,
      description: "Mercado",
      accountId: account.id,
      categoryId: category.id
    }];

    const state = data(transactions);
    expect(calculateAccountBalance(account.id, state)).toBe(account.openingBalanceCents);
    expect(calculateProjectedAccountBalance(account.id, state)).toBe(account.openingBalanceCents);
    expect(expensesByCategory(state, "2026-09")).toEqual([]);
    expect(cashFlow(state, "2026-09")).toMatchObject({
      incomeCents: 0,
      expenseCents: 0,
      cardPaymentsCents: 0,
      netCents: 0
    });
    expect(getBudgetSpent(state, state.budgets[0])).toBe(0);
  });

  it("removes a cancelled card purchase from outstanding and invoice", () => {
    const transactions = [{
      id: "purchase-1",
      date: "2026-09-05",
      type: "EXPENSE" as const,
      status: "CANCELLED" as const,
      amountCents: 20000,
      description: "Compra no cartão",
      creditCardId: card.id,
      categoryId: category.id
    }];

    expect(calculateCardOutstanding(card, transactions)).toBe(0);
    expect(getCardInvoice(card, transactions, "2026-09-10")).toMatchObject({
      purchaseTotalCents: 0,
      paymentTotalCents: 0,
      openAmountCents: 0
    });
  });

  it("removes a cancelled card payment from account cash impact and card allocation", () => {
    const transactions = [{
      id: "purchase-1",
      date: "2026-09-05",
      type: "EXPENSE" as const,
      status: "PAID" as const,
      amountCents: 20000,
      description: "Compra",
      creditCardId: card.id
    }, {
      id: "payment-1",
      date: "2026-09-20",
      type: "CARD_PAYMENT" as const,
      status: "CANCELLED" as const,
      amountCents: 10000,
      description: "Pagamento cancelado",
      accountId: account.id,
      creditCardId: card.id
    }];

    const state = data(transactions);
    expect(calculateAccountBalance(account.id, state)).toBe(account.openingBalanceCents);
    expect(calculateCardOutstanding(card, transactions)).toBe(20000);
    expect(getCardInvoice(card, transactions, "2026-09-10")).toMatchObject({
      purchaseTotalCents: 20000,
      paymentTotalCents: 0,
      openAmountCents: 20000
    });
  });

  it("keeps installment group metadata when cancelling one or following installments", () => {
    const created = buildInstallmentSet({
      totalAmountCents: 30000,
      installmentCount: 3,
      firstDate: "2026-09-05",
      description: "Compra parcelada",
      status: "PAID",
      creditCardId: card.id
    });

    const state = {
      ...data(created.transactions),
      installmentGroups: [created.group]
    };
    const next = cancelInstallments(state, created.group.id, created.transactions[1].id, "THIS_AND_FOLLOWING");

    expect(next.installmentGroups[0]).toEqual(created.group);
    expect(next.transactions.map(t => t.status)).toEqual(["PAID", "CANCELLED", "CANCELLED"]);
    expect(calculateCardOutstanding(card, next.transactions)).toBe(10000);
  });

  it("deactivates a recurring rule without deleting generated history or generating new entries", () => {
    const rule = createRecurringRule({
      description: "Aluguel",
      frequency: "MONTHLY",
      startDate: "2026-09-01",
      amountCents: 100000,
      type: "EXPENSE",
      status: "PLANNED",
      accountId: account.id,
      active: true
    });
    const initial: EntityCollection = {
      ...data([]),
      recurringRules: [rule]
    };

    const generated = generateRecurringTransactions(initial, rule, "2026-11-30");
    expect(generated.generated).toHaveLength(3);
    const deactivated = deactivateRecurringRule(generated.data, rule.id);
    expect(deactivated.recurringRules.find(r => r.id === rule.id)?.active).toBe(false);
    expect(deactivated.transactions).toHaveLength(3);

    const inactiveRule = deactivated.recurringRules.find(r => r.id === rule.id)!;
    const after = generateRecurringTransactions(deactivated, inactiveRule, "2027-12-31");
    expect(after.generated).toHaveLength(0);
    expect(after.data.transactions).toHaveLength(3);
  });
});
