import type { EntityCollection } from "../../infrastructure/persistence/repository";
import type { RecurringFrequency, RecurringRule, Transaction } from "../types/entities";
import { addDays, addMonths, assertFinancialDate } from "../date/financial-date";
import { assertNonNegativeCents } from "../money/cents";
import { validateTransaction } from "../transactions/financial-engine";

export function nextRecurringDate(date:string,frequency:RecurringFrequency):string{
  switch(frequency){
    case "WEEKLY": return addDays(date,7);
    case "BIWEEKLY": return addDays(date,14);
    case "MONTHLY": return addMonths(date,1);
    case "BIMONTHLY": return addMonths(date,2);
    case "QUARTERLY": return addMonths(date,3);
    case "SEMIANNUAL": return addMonths(date,6);
    case "ANNUAL": return addMonths(date,12);
  }
}

export type RecurringRuleInput=Omit<RecurringRule,"id"|"transactionIds">;

export function createRecurringRule(input:RecurringRuleInput):RecurringRule{
  assertFinancialDate(input.startDate);
  if(input.endDate) assertFinancialDate(input.endDate);
  assertNonNegativeCents(input.amountCents,"amountCents");
  if(input.endDate && input.endDate<input.startDate) throw new Error("endDate must not precede startDate");
  if(!input.description.trim()) throw new Error("Informe uma descrição.");
  if(!input.accountId) throw new Error("Lançamento recorrente precisa de uma conta.");
  if(input.type==="INCOME" && input.creditCardId) throw new Error("Entrada recorrente não pode usar cartão.");
  if(input.type==="EXPENSE" && input.accountId && input.creditCardId) throw new Error("Use conta ou cartão, não ambos.");
  return {...input,id:crypto.randomUUID(),description:input.description.trim(),transactionIds:[]};
}

export function generateRecurringTransactions(
  data:EntityCollection,
  rule:RecurringRule,
  throughDate:string
):{data:EntityCollection;generated:Transaction[]}{
  assertFinancialDate(throughDate);
  if(!rule.active) return {data,generated:[]};
  const existingDates=new Set(
    rule.transactionIds
      .map(id=>data.transactions.find(t=>t.id===id)?.date)
      .filter((d):d is string=>Boolean(d))
  );
  const generated:Transaction[]=[];
  let date=rule.startDate;
  while(date<=throughDate){
    if((!rule.endDate||date<=rule.endDate)&&!existingDates.has(date)){
      const tx:Transaction={
        id:crypto.randomUUID(),
        date,
        type:rule.type,
        status:rule.status,
        amountCents:rule.amountCents,
        description:rule.description,
        ...(rule.categoryId?{categoryId:rule.categoryId}:{}),
        ...(rule.accountId?{accountId:rule.accountId}:{}),
        ...(rule.creditCardId?{creditCardId:rule.creditCardId}:{}),
        ...(rule.personId?{personId:rule.personId}:{}),
      };
      validateTransaction(tx,{accounts:data.accounts,cards:data.cards,transactions:[...data.transactions,...generated]});
      generated.push(tx);
    }
    date=nextRecurringDate(date,rule.frequency);
  }
  if(!generated.length)return {data,generated};
  const ids=[...rule.transactionIds,...generated.map(t=>t.id)];
  const nextRule={...rule,transactionIds:ids};
  return {
    data:{...data,transactions:[...data.transactions,...generated],recurringRules:data.recurringRules.map(r=>r.id===rule.id?nextRule:r)},
    generated
  };
}

export function deactivateRecurringRule(data:EntityCollection,ruleId:string):EntityCollection{
  if(!data.recurringRules.some(r=>r.id===ruleId)) throw new Error("Regra recorrente não encontrada.");
  return {...data,recurringRules:data.recurringRules.map(r=>r.id===ruleId?{...r,active:false}:r)};
}
