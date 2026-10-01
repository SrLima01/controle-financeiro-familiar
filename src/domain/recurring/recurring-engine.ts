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

function recurringDateFromStart(startDate:string,frequency:RecurringFrequency,occurrenceIndex:number):string{
  if(occurrenceIndex===0)return startDate;
  switch(frequency){
    case "WEEKLY": return addDays(startDate,7*occurrenceIndex);
    case "BIWEEKLY": return addDays(startDate,14*occurrenceIndex);
    case "MONTHLY": return addMonths(startDate,occurrenceIndex);
    case "BIMONTHLY": return addMonths(startDate,2*occurrenceIndex);
    case "QUARTERLY": return addMonths(startDate,3*occurrenceIndex);
    case "SEMIANNUAL": return addMonths(startDate,6*occurrenceIndex);
    case "ANNUAL": return addMonths(startDate,12*occurrenceIndex);
  }
}

export type RecurringRuleInput=Omit<RecurringRule,"id"|"transactionIds">;

export function createRecurringRule(input:RecurringRuleInput):RecurringRule{
  assertFinancialDate(input.startDate);
  if(input.endDate) assertFinancialDate(input.endDate);
  assertNonNegativeCents(input.amountCents,"amountCents");
  if(input.amountCents<=0) throw new Error("O valor da recorrência deve ser maior que zero.");
  if(input.endDate && input.endDate<input.startDate) throw new Error("endDate must not precede startDate");
  if(!input.description.trim()) throw new Error("Informe uma descrição.");
  if(input.type==="INCOME" && (!input.accountId || input.creditCardId)) throw new Error("Entrada recorrente precisa de uma conta e não pode usar cartão.");
  if(input.type==="EXPENSE" && (!!input.accountId === !!input.creditCardId)) throw new Error("Despesa recorrente deve usar exatamente uma conta ou um cartão.");
  return {...input,id:crypto.randomUUID(),description:input.description.trim(),transactionIds:[]};
}

export function validateRecurringRuleUpdate(previous:RecurringRule,next:RecurringRule):void{
  if(previous.id!==next.id) throw new Error("Recurring rule id cannot change");
  if(previous.transactionIds.length>0) throw new Error("Recurring rules with generated transactions cannot be edited. Create a new rule to preserve history.");
  if(JSON.stringify(previous.transactionIds)!==JSON.stringify(next.transactionIds)) throw new Error("Recurring rule transaction history cannot change");
  const {id: _id, transactionIds: _transactionIds, ...input}=next;
  createRecurringRule(input);
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
  let occurrenceIndex=0;
  let date=recurringDateFromStart(rule.startDate,rule.frequency,occurrenceIndex);
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
    occurrenceIndex+=1;
    date=recurringDateFromStart(rule.startDate,rule.frequency,occurrenceIndex);
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
