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
  if (d <= closingDay) return iso(y, m, closingDay);
  return iso(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, closingDay);
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

export function getCardInvoice(
  card: CreditCard,
  transactions: readonly Transaction[],
  referenceDate: string,
): CardInvoice {
  const closing = invoiceClosingDate(referenceDate, card.closingDay);
  const previousClose = previousMonthDate(closing, card.closingDay);
  const due = invoiceDueDateFromClosing(closing, card.closingDay, card.dueDay);

  let purchases = 0;
  let payments = 0;

  for (const tx of transactions) {
    if (tx.status === "CANCELLED" || tx.creditCardId !== card.id) continue;
    if (tx.type === "EXPENSE" && tx.status !== "PLANNED" && tx.date > previousClose && tx.date <= closing) {
      purchases += tx.amountCents;
    }
    if (tx.type === "CARD_PAYMENT" && tx.status === "PAID" && tx.date >= closing && tx.date <= due) {
      payments += tx.amountCents;
    }
  }

  const open = Math.max(0, purchases - payments);
  assertCents(purchases);
  assertCents(payments);
  assertCents(open);

  return {
    cardId: card.id,
    closingDate: closing,
    dueDate: due,
    purchaseTotalCents: purchases,
    paymentTotalCents: payments,
    openAmountCents: open,
  };
}

export function calculateCardOutstanding(
  card: CreditCard,
  transactions: readonly Transaction[],
): number {
  let total = 0;
  for (const tx of transactions) {
    if (
      tx.status !== "CANCELLED" &&
      tx.creditCardId === card.id &&
      tx.type === "EXPENSE" && tx.status === "PAID"
    ) {
      total += tx.amountCents;
    }
  }

  for (const tx of transactions) {
    if (
      tx.status !== "CANCELLED" &&
      tx.creditCardId === card.id &&
      tx.type === "CARD_PAYMENT" && tx.status === "PAID"
    ) {
      total -= tx.amountCents;
    }
  }

  assertCents(total, "cardOutstanding");
  return Math.max(0, total);
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
