import type { EntityCollection } from "../../infrastructure/persistence/repository";
import type { Budget } from "../types/entities";
import { assertNonNegativeCents } from "../money/cents";

export type BudgetStatus="NORMAL"|"ATTENTION"|"EXCEEDED";
export function getBudgetSpent(data:EntityCollection,budget:Budget):number{
  return data.transactions.filter(t=>t.type==="EXPENSE"&&t.status!=="CANCELLED"&&t.categoryId===budget.categoryId&&t.date.slice(0,7)===budget.month)
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
export function createBudget(month:string,categoryId:string,limitCents:number):Budget{
  if(!/^\d{4}-\d{2}$/.test(month))throw new Error("Mês inválido.");
  if(!categoryId)throw new Error("Selecione uma categoria.");
  assertNonNegativeCents(limitCents,"limitCents");
  return {id:crypto.randomUUID(),month,categoryId,limitCents,active:true};
}
