import type { CreditCard, Transaction } from "../types/entities";
import { assertCents } from "../money/cents";
import { assertFinancialDate } from "../date/financial-date";

export function validateCreditCard(card: CreditCard, accountIds: readonly string[]): void {
  if (!card.id || !card.name.trim()) throw new Error("Cartão inválido");
  assertCents(card.creditLimitCents, "creditLimitCents");
  if (card.creditLimitCents < 0) throw new Error("Credit limit cannot be negative");
  if (!accountIds.includes(card.accountId)) throw new Error("Invalid card payment account");
  if (!Number.isInteger(card.closingDay) || card.closingDay < 1 || card.closingDay > 31) throw new Error("Invalid closing day");
  if (!Number.isInteger(card.dueDay) || card.dueDay < 1 || card.dueDay > 31) throw new Error("Invalid due day");
}

export function validateCreditCardUpdate(
  previous: CreditCard,
  next: CreditCard,
  accountIds: readonly string[],
  transactions: readonly Transaction[],
): void {
  validateCreditCard(next, accountIds);
  if (previous.id !== next.id) throw new Error("Cartão inválido para edição");
  const hasHistory = transactions.some(tx => tx.creditCardId === previous.id && tx.status !== "CANCELLED");
  if (hasHistory && previous.accountId !== next.accountId) {
    throw new Error("A conta de pagamento não pode ser alterada após haver movimentações no cartão.");
  }
  if (hasHistory && previous.closingDay !== next.closingDay) {
    throw new Error("O dia de fechamento não pode ser alterado após haver movimentações no cartão.");
  }
  if (hasHistory && previous.dueDay !== next.dueDay) {
    throw new Error("O dia de vencimento não pode ser alterado após haver movimentações no cartão.");
  }
}

export type CardInvoice = {
  cardId: string;
  closingDate: string;
  dueDate: string;
  purchaseTotalCents: number;
  paymentTotalCents: number;
  openAmountCents: number;
};

type InvoicePurchase = { date: string; amountCents: number };
type InvoiceBucket = {
  closingDate: string;
  dueDate: string;
  purchases: InvoicePurchase[];
  purchaseTotalCents: number;
  paymentTotalCents: number;
};

export type CardPaymentAllocation = {
  transactionId: string;
  amountCents: number;
  closingDate: string;
};

function dateParts(date: string) {
  assertFinancialDate(date);
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}

function previousMonthDate(date: string, day: number): string {
  const { y, m } = dateParts(date);
  const previousM = m === 1 ? 12 : m - 1;
  const previousY = m === 1 ? y - 1 : y;
  return iso(previousY, previousM, day);
}

function iso(y: number, m: number, d: number) {
  const mm = String(m).padStart(2, "0");
  const dd = String(Math.min(d, daysInMonth(y, m))).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

export function invoiceClosingDate(purchaseDate: string, closingDay: number): string {
  const { y, m, d } = dateParts(purchaseDate);
  if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) {
    throw new Error("Invalid closing day");
  }

  const currentClosingDay = Math.min(closingDay, daysInMonth(y, m));
  if (d <= currentClosingDay) return iso(y, m, closingDay);

  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  return iso(nextY, nextM, closingDay);
}

export function invoiceDueDateFromClosing(
  closingDate: string,
  closingDay: number,
  dueDay: number,
): string {
  const { y, m } = dateParts(closingDate);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new Error("Invalid due day");
  }
  const nextMonth = dueDay <= closingDay;
  const targetM = nextMonth ? (m === 12 ? 1 : m + 1) : m;
  const targetY = nextMonth ? (m === 12 ? y + 1 : y) : y;
  return iso(targetY, targetM, dueDay);
}

export function allocateCardPayments(
  card: CreditCard,
  transactions: readonly Transaction[],
): CardPaymentAllocation[] {
  const buckets = new Map<string, InvoiceBucket>();

  for (const tx of transactions) {
    if (tx.status !== "PAID" || tx.creditCardId !== card.id || tx.type !== "EXPENSE") continue;
    const closingDate = invoiceClosingDate(tx.date, card.closingDay);
    const existing = buckets.get(closingDate);
    if (existing) {
      existing.purchases.push({ date: tx.date, amountCents: tx.amountCents });
      existing.purchaseTotalCents += tx.amountCents;
    } else {
      buckets.set(closingDate, {
        closingDate,
        dueDate: invoiceDueDateFromClosing(closingDate, card.closingDay, card.dueDay),
        purchases: [{ date: tx.date, amountCents: tx.amountCents }],
        purchaseTotalCents: tx.amountCents,
        paymentTotalCents: 0,
      });
    }
  }

  const invoices = [...buckets.values()].sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  const payments = transactions
    .filter(tx => tx.status === "PAID" && tx.creditCardId === card.id && tx.type === "CARD_PAYMENT")
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const allocations: CardPaymentAllocation[] = [];
  for (const payment of payments) {
    let remaining = payment.amountCents;
    for (const invoice of invoices) {
      if (remaining <= 0) break;
      const eligiblePurchases = invoice.purchases
        .filter(purchase => purchase.date <= payment.date)
        .reduce((sum, purchase) => sum + purchase.amountCents, 0);
      const open = eligiblePurchases - invoice.paymentTotalCents;
      if (open <= 0) continue;
      const applied = Math.min(remaining, open);
      invoice.paymentTotalCents += applied;
      remaining -= applied;
      allocations.push({
        transactionId: payment.id,
        amountCents: applied,
        closingDate: invoice.closingDate,
      });
    }
  }

  return allocations;
}

export function getCardInvoice(
  card: CreditCard,
  transactions: readonly Transaction[],
  referenceDate: string,
): CardInvoice {
  const closing = invoiceClosingDate(referenceDate, card.closingDay);
  const due = invoiceDueDateFromClosing(closing, card.closingDay, card.dueDay);
  const previousClose = previousMonthDate(closing, card.closingDay);

  let purchases = 0;
  for (const tx of transactions) {
    if (
      tx.status === "PAID" &&
      tx.creditCardId === card.id &&
      tx.type === "EXPENSE" &&
      tx.date > previousClose &&
      tx.date <= closing
    ) {
      purchases += tx.amountCents;
    }
  }

  const allocations = allocateCardPayments(card, transactions)
    .filter(allocation => allocation.closingDate === closing)
    .reduce((sum, allocation) => sum + allocation.amountCents, 0);

  const open = Math.max(0, purchases - allocations);
  assertCents(purchases);
  assertCents(allocations);
  assertCents(open);

  return {
    cardId: card.id,
    closingDate: closing,
    dueDate: due,
    purchaseTotalCents: purchases,
    paymentTotalCents: allocations,
    openAmountCents: open,
  };
}

export function calculateCardOutstanding(
  card: CreditCard,
  transactions: readonly Transaction[],
): number {
  let purchases = 0;
  for (const tx of transactions) {
    if (tx.status === "PAID" && tx.creditCardId === card.id && tx.type === "EXPENSE") {
      purchases += tx.amountCents;
    }
  }

  const allocatedPayments = allocateCardPayments(card, transactions)
    .reduce((sum, allocation) => sum + allocation.amountCents, 0);
  const outstanding = Math.max(0, purchases - allocatedPayments);
  assertCents(outstanding, "cardOutstanding");
  return outstanding;
}

export function calculateCardAvailableLimit(
  card: CreditCard,
  transactions: readonly Transaction[],
): number {
  const available =
    card.creditLimitCents - calculateCardOutstanding(card, transactions);
  assertCents(available, "cardAvailableLimit");
  return available;
}
