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

export function validateRecurringTransactionUpdate(previous:Transaction,next:Transaction,rules:readonly RecurringRule[]):void{
  const generated=rules.some(rule=>rule.transactionIds.includes(previous.id));
  if(generated&&next.date!==previous.date) throw new Error("A data de um lançamento gerado por recorrência não pode ser alterada. Desative a regra e crie uma nova série para mudar a agenda.");
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
  if(JSON.stringify(previous.transactionIds)!==JSON.stringify(next.transactionIds)) throw new Error("Recurring rule transaction history cannot change");
  const {id: _id, transactionIds: _transactionIds, ...input}=next;
  createRecurringRule(input);
}

export function applyRecurringRuleToFutureTransactions(
 data:EntityCollection,
 previous:RecurringRule,
 next:RecurringRule,
 fromDate:string
):EntityCollection{
 const generatedIds=new Set(previous.transactionIds);
 const transactions=data.transactions.map(tx=>{
   if(!generatedIds.has(tx.id)||tx.date<fromDate) return tx;
   const nextTx:Transaction={
     ...tx,
     description:next.description,
     amountCents:next.amountCents,
     status:next.status,
     ...(next.categoryId?{categoryId:next.categoryId}:{}),
     ...(next.accountId?{accountId:next.accountId}:{}),
     ...(next.creditCardId?{creditCardId:next.creditCardId}:{}),
     ...(next.personId?{personId:next.personId}:{}),
   };
   if(!next.categoryId) delete nextTx.categoryId;
   if(!next.accountId) delete nextTx.accountId;
   if(!next.creditCardId) delete nextTx.creditCardId;
   if(!next.personId) delete nextTx.personId;
   validateTransaction(nextTx,{accounts:data.accounts,cards:data.cards,transactions:data.transactions});
   return nextTx;
 });
 return {...data,transactions};
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

export function ensureRecurringHorizon(
  data:EntityCollection,
  throughDate:string
):EntityCollection{
  assertFinancialDate(throughDate);
  let current=data;
  for(const rule of data.recurringRules){
    if(!rule.active) continue;
    const result=generateRecurringTransactions(current,rule,throughDate);
    if(result.generated.length) current=result.data;
  }
  return current;
}

export function deactivateRecurringRule(data:EntityCollection,ruleId:string):EntityCollection{
  if(!data.recurringRules.some(r=>r.id===ruleId)) throw new Error("Regra recorrente não encontrada.");
  return {...data,recurringRules:data.recurringRules.map(r=>r.id===ruleId?{...r,active:false}:r)};
}
