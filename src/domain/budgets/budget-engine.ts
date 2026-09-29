import type { EntityCollection } from "../../infrastructure/persistence/repository";
import type { Budget } from "../types/entities";
import { assertNonNegativeCents } from "../money/cents";

export type BudgetStatus="NORMAL"|"ATTENTION"|"EXCEEDED";

export function getBudgetSpent(data:EntityCollection,budget:Budget):number{
  return data.transactions
    .filter(t=>t.type==="EXPENSE"&&(t.status==="PAID"||t.status==="RECEIVED")&&t.categoryId===budget.categoryId&&t.date.slice(0,7)===budget.month)
    .reduce((sum,t)=>sum+t.amountCents,0);
}
export function getBudgetPercentage(spent:number,limit:number):number{
  return limit===0 ? (spent>0?Infinity:0) : spent/limit*100;
}
export function getBudgetStatus(spent:number,limit:number):BudgetStatus{
  const pct=getBudgetPercentage(spent,limit);
  if(pct>100)return "EXCEEDED";
  if(pct>=80)return "ATTENTION";
  return "NORMAL";
}
export function createBudget(month:string,categoryId:string,limitCents:number,data?:EntityCollection):Budget{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error("Mês inválido.");
  if(!categoryId)throw new Error("Selecione uma categoria.");
  assertNonNegativeCents(limitCents,"limitCents");
  if(data?.budgets.some(b=>b.active&&b.month===month&&b.categoryId===categoryId))throw new Error("Já existe um orçamento ativo para esta categoria neste mês.");
  const category=data?.categories.find(c=>c.id===categoryId);
  if(category?.kind!=="EXPENSE")throw new Error("Orçamento deve usar uma categoria de despesa.");
  return {id:crypto.randomUUID(),month,categoryId,limitCents,active:true};
}
