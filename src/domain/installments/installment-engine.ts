import type { EntityCollection } from "../../infrastructure/persistence/repository";
import type { InstallmentGroup, Transaction } from "../types/entities";
import { splitIntoInstallments } from "./split-into-installments";
import { assertNonNegativeCents } from "../money/cents";

export type InstallmentInput = {
  groupId?: string;
  totalAmountCents: number;
  installmentCount: number;
  firstDate: string;
  description: string;
  status: Transaction["status"];
  accountId?: string;
  creditCardId?: string;
  categoryId?: string;
  personId?: string;
};

export function buildInstallmentSet(input: InstallmentInput): {
  group: InstallmentGroup;
  transactions: Transaction[];
} {
  assertNonNegativeCents(input.totalAmountCents, "totalAmountCents");
  if (input.totalAmountCents <= 0) throw new Error("Valor total do parcelamento deve ser maior que zero.");
  if (!Number.isInteger(input.installmentCount) || input.installmentCount < 2) {
    throw new Error("Parcelamento deve ter pelo menos 2 parcelas.");
  }
  if (!input.description.trim()) throw new Error("Informe uma descrição.");
  if ((input.accountId && input.creditCardId) || (!input.accountId && !input.creditCardId)) {
    throw new Error("Informe conta ou cartão para o parcelamento.");
  }

  const groupId = input.groupId ?? crypto.randomUUID();
  const drafts = splitIntoInstallments(input.totalAmountCents, input.installmentCount, input.firstDate);
  const transactions = drafts.map(draft => ({
    id: crypto.randomUUID(),
    date: draft.date,
    type: "EXPENSE" as const,
    status: input.status,
    amountCents: draft.amountCents,
    description: `${input.description.trim()} (${draft.index}/${input.installmentCount})`,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.creditCardId ? { creditCardId: input.creditCardId } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.personId ? { personId: input.personId } : {}),
    installmentGroupId: groupId
  }));

  return {
    group: {
      id: groupId,
      description: input.description.trim(),
      totalAmountCents: input.totalAmountCents,
      installmentCount: input.installmentCount,
      firstDate: input.firstDate,
      transactionIds: transactions.map(t => t.id)
    },
    transactions
  };
}

export function cancelInstallments(
  data: EntityCollection,
  groupId: string,
  transactionId: string,
  mode: "ONE" | "THIS_AND_FOLLOWING"
): EntityCollection {
  const group = data.installmentGroups.find(g => g.id === groupId);
  if (!group) throw new Error("Grupo de parcelas não encontrado.");
  const index = group.transactionIds.indexOf(transactionId);
  if (index < 0) throw new Error("Parcela não pertence ao grupo.");

  const ids = mode === "ONE" ? [transactionId] : group.transactionIds.slice(index);
  const idSet = new Set(ids);
  return {
    ...data,
    transactions: data.transactions.map(tx =>
      idSet.has(tx.id) ? { ...tx, status: "CANCELLED" as const } : tx
    )
  };
}

export function getInstallmentNumber(group: InstallmentGroup, transactionId: string): number {
  const index = group.transactionIds.indexOf(transactionId);
  if (index < 0) throw new Error("Parcela não pertence ao grupo.");
  return index + 1;
}
