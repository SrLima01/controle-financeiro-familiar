import { describe, expect, it } from "vitest";
import type { EntityCollection } from "../infrastructure/persistence/repository";
import { calculateAccountBalance } from "./financial-engine";
import { expensesByCategory, cashFlow } from "../reports/report-engine";
import { getBudgetSpent } from "../budgets/budget-engine";
import { calculateCardAvailableLimit, calculateCardOutstanding, getCardInvoice } from "../cards/card-engine";
import { cancelInstallments, buildInstallmentSet } from "../installments/installment-engine";
import { createRecurringRule, generateRecurringTransactions, deactivateRecurringRule } from "../recurring/recurring-engine";

const account = {
  id: "account-1",
  name: "Conta",
  type: "CHECKING" as const,
  openingBalanceCents: 100000,
  active: true,
};

const card = {
  id: "card-1",
  name: "Cartão",
  accountId: "account-1",
  creditLimitCents: 100000,
  closingDay: 10,
  dueDay: 20,
  active: true,
};

const category = {
  id: "category-1",
  name: "Alimentação",
  kind: "EXPENSE" as const,
  active: true,
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
    budgets: [{
      id: "budget-1",
      month: "2026-09",
      categoryId: category.id,
      limitCents: 50000,
      active: true,
    }],
  };
}

describe("cancellation integrity", () => {
  it("removing a cancelled bank expense restores account balance and realized reports", () => {
    const transactions = [{
      id: "expense-1",
      date: "2026-09-05",
      type: "EXPENSE" as const,
      status: "PAID" as const,
      amountCents: 20000,
      description: "Mercado",
      accountId: account.id,
      categoryId: category.id,
    }];

    const before = data(transactions);
    expect(calculateAccountBalance(account.id, before)).toBe(80000);
    expect(expensesByCategory(before, "2026-09")).toEqual([
      { categoryId: category.id, name: category.name, amountCents: 20000 },
    ]);
    expect(getBudgetSpent(before, before.budgets[0])).toBe(20000);

    const cancelled = data([{ ...transactions[0], status: "CANCELLED" as const }]);

    expect(calculateAccountBalance(account.id, cancelled)).toBe(100000);
    expect(expensesByCategory(cancelled, "2026-09")).toEqual([]);
    expect(getBudgetSpent(cancelled, cancelled.budgets[0])).toBe(0);
    expect(cashFlow(cancelled, "2026-09")).toMatchObject({
      expenseCents: 0,
      netCents: 0,
    });
  });

  it("cancelling a card purchase restores outstanding limit and invoice amount", () => {
    const purchase = {
      id: "purchase-1",
      date: "2026-09-05",
      type: "EXPENSE" as const,
      status: "PAID" as const,
      amountCents: 30000,
      description: "Compra",
      creditCardId: card.id,
      categoryId: category.id,
    };

    const active = data([purchase]);
    expect(calculateCardOutstanding(card, active.transactions)).toBe(30000);
    expect(calculateCardAvailableLimit(card, active.transactions)).toBe(70000);
    expect(getCardInvoice(card, active.transactions, "2026-09-10")).toMatchObject({
      purchaseTotalCents: 30000,
      openAmountCents: 30000,
    });

    const cancelled = data([{ ...purchase, status: "CANCELLED" as const }]);
    expect(calculateCardOutstanding(card, cancelled.transactions)).toBe(0);
    expect(calculateCardAvailableLimit(card, cancelled.transactions)).toBe(100000);
    expect(getCardInvoice(card, cancelled.transactions, "2026-09-10")).toMatchObject({
      purchaseTotalCents: 0,
      openAmountCents: 0,
    });
  });

  it("cancelling a card payment restores the card debt without creating another expense", () => {
    const transactions = [
      {
        id: "purchase-1",
        date: "2026-09-05",
        type: "EXPENSE" as const,
        status: "PAID" as const,
        amountCents: 30000,
        description: "Compra",
        creditCardId: card.id,
      },
      {
        id: "payment-1",
        date: "2026-09-20",
        type: "CARD_PAYMENT" as const,
        status: "PAID" as const,
        amountCents: 10000,
        description: "Pagamento",
        accountId: account.id,
        creditCardId: card.id,
      },
    ];

    const active = data(transactions);
    expect(calculateAccountBalance(account.id, active)).toBe(90000);
    expect(calculateCardOutstanding(card, active.transactions)).toBe(20000);
    expect(cashFlow(active, "2026-09")).toMatchObject({
      expenseCents: 0,
      cardPaymentsCents: 10000,
      netCents: -10000,
    });

    const cancelled = data([transactions[0], { ...transactions[1], status: "CANCELLED" as const }]);
    expect(calculateAccountBalance(account.id, cancelled)).toBe(100000);
    expect(calculateCardOutstanding(card, cancelled.transactions)).toBe(30000);
    expect(cashFlow(cancelled, "2026-09")).toMatchObject({
      expenseCents: 0,
      cardPaymentsCents: 0,
      netCents: 0,
    });
  });

  it("cancelling installments changes only their realized financial effect and preserves group metadata", () => {
    const created = buildInstallmentSet({
      totalAmountCents: 30000,
      installmentCount: 3,
      firstDate: "2026-09-05",
      description: "Compra parcelada",
      status: "PAID",
      accountId: account.id,
    });
    const initial: EntityCollection = {
      ...data(created.transactions),
      installmentGroups: [created.group],
    };

    const cancelled = cancelInstallments(
      initial,
      created.group.id,
      created.transactions[1].id,
      "THIS_AND_FOLLOWING",
    );

    expect(cancelled.installmentGroups).toEqual([created.group]);
    expect(cancelled.transactions.map(t => t.status)).toEqual([
      "PAID",
      "CANCELLED",
      "CANCELLED",
    ]);
    expect(calculateAccountBalance(account.id, cancelled)).toBe(90000);
  });

  it("cancelling a generated recurring transaction does not regenerate that occurrence", () => {
    const rule = createRecurringRule({
      description: "Aluguel",
      frequency: "MONTHLY",
      startDate: "2026-09-01",
      amountCents: 50000,
      type: "EXPENSE",
      status: "PAID",
      accountId: account.id,
      active: true,
    });
    const initial: EntityCollection = {
      ...data([]),
      recurringRules: [rule],
    };

    const first = generateRecurringTransactions(initial, rule, "2026-10-01");
    expect(first.generated).toHaveLength(2);

    const cancelledTransaction = {
      ...first.generated[0],
      status: "CANCELLED" as const,
    };
    const cancelledState: EntityCollection = {
      ...first.data,
      transactions: first.data.transactions.map(t =>
        t.id === cancelledTransaction.id ? cancelledTransaction : t
      ),
    };

    const currentRule = cancelledState.recurringRules[0];
    const next = generateRecurringTransactions(cancelledState, currentRule, "2026-10-01");

    expect(next.generated).toHaveLength(0);
    expect(next.data.transactions.find(t => t.id === cancelledTransaction.id)?.status).toBe("CANCELLED");
    expect(next.data.recurringRules[0].transactionIds).toContain(cancelledTransaction.id);
  });

  it("deactivating a recurring rule stops future generation while preserving generated history", () => {
    const rule = createRecurringRule({
      description: "Aluguel",
      frequency: "MONTHLY",
      startDate: "2026-09-01",
      amountCents: 50000,
      type: "EXPENSE",
      status: "PLANNED",
      accountId: account.id,
      active: true,
    });
    const initial: EntityCollection = {
      ...data([]),
      recurringRules: [rule],
    };

    const generated = generateRecurringTransactions(initial, rule, "2026-11-01");
    const deactivated = deactivateRecurringRule(generated.data, rule.id);

    expect(deactivated.recurringRules[0].active).toBe(false);
    expect(deactivated.transactions).toHaveLength(3);
    expect(deactivated.recurringRules[0].transactionIds).toHaveLength(3);

    const noMore = generateRecurringTransactions(
      deactivated,
      deactivated.recurringRules[0],
      "2027-02-01",
    );
    expect(noMore.generated).toHaveLength(0);
    expect(noMore.data.transactions).toHaveLength(3);
  });
});
