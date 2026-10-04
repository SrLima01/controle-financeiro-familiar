import { describe, expect, it } from "vitest";
import { applyRecurringRuleToFutureTransactions, createRecurringRule, generateRecurringTransactions, nextRecurringDate, validateRecurringRuleUpdate, validateRecurringTransactionUpdate } from "./recurring-engine";
import type { EntityCollection } from "../../infrastructure/persistence/repository";

const accounts=[{id:"a",name:"Conta",type:"CHECKING" as const,openingBalanceCents:0,active:true}];
const base={description:"Aluguel",frequency:"MONTHLY" as const,startDate:"2026-01-31",amountCents:100000,type:"EXPENSE" as const,status:"PLANNED" as const,accountId:"a",active:true};

describe("recurring engine",()=>{
 it("rejects a zero-value recurring rule",()=>{
   expect(()=>createRecurringRule({...base,amountCents:0})).toThrow("maior que zero");
 });
 it("advances dates according to frequency",()=>{
   expect(nextRecurringDate("2026-01-31","MONTHLY")).toBe("2026-02-28");
   expect(nextRecurringDate("2026-01-05","BIWEEKLY")).toBe("2026-01-19");
 });
 it("preserves the original day anchor across short months",()=>{
   const rule=createRecurringRule(base);
   const data:EntityCollection={people:[],categories:[],accounts,cards:[],transactions:[],installmentGroups:[],recurringRules:[rule],pots:[],potMovements:[],budgets:[]};
   const result=generateRecurringTransactions(data,rule,"2026-05-31");
   expect(result.generated.map(t=>t.date)).toEqual([
     "2026-01-31","2026-02-28","2026-03-31","2026-04-30","2026-05-31"
   ]);
 });
 it("creates a rule and generates only missing occurrences",()=>{
   const rule=createRecurringRule(base);
   const data:EntityCollection={people:[],categories:[],accounts,cards:[],transactions:[],installmentGroups:[],recurringRules:[rule],pots:[],potMovements:[],budgets:[]};
   const first=generateRecurringTransactions(data,rule,"2026-03-31");
   expect(first.generated).toHaveLength(3);
   const second=generateRecurringTransactions(first.data,first.data.recurringRules[0],"2026-05-31");
   expect(second.generated).toHaveLength(2);
   expect(second.data.transactions).toHaveLength(5);
 });
 it("rejects changing the date of a generated occurrence",()=>{
   const rule=createRecurringRule(base);
   const data: EntityCollection = {people:[],categories:[],accounts,cards:[],transactions:[],installmentGroups:[],recurringRules:[rule],pots:[],potMovements:[],budgets:[]};
   const generated=generateRecurringTransactions(data,rule,"2026-03-31");
   const tx=generated.generated[0];
   expect(()=>validateRecurringTransactionUpdate(tx,{...tx,date:"2026-02-01"},generated.data.recurringRules)).toThrow();
   expect(()=>validateRecurringTransactionUpdate(tx,{...tx,description:"Aluguel ajustado"},generated.data.recurringRules)).not.toThrow();
 });
 it("does not generate beyond end date",()=>{
   const rule=createRecurringRule({...base,endDate:"2026-02-28"});
   const data:EntityCollection={people:[],categories:[],accounts,cards:[],transactions:[],installmentGroups:[],recurringRules:[rule],pots:[],potMovements:[],budgets:[]};
   expect(generateRecurringTransactions(data,rule,"2026-12-31").generated).toHaveLength(2);
 });
 it("allows editing a generated rule while preserving its transaction history",()=>{
   const rule=createRecurringRule(base);
   const data:EntityCollection={people:[],categories:[],accounts,cards:[],transactions:[],installmentGroups:[],recurringRules:[rule],pots:[],potMovements:[],budgets:[]};
   const generated=generateRecurringTransactions(data,rule,"2026-03-31");
   const stored=generated.data.recurringRules[0];
   expect(()=>validateRecurringRuleUpdate(stored,{...stored,amountCents:200000})).not.toThrow();
   expect(stored.transactionIds).toHaveLength(3);
 });
 it("propagates recurring rule edits to future generated transactions only",()=>{
   const rule=createRecurringRule(base);
   const data:EntityCollection={people:[],categories:[],accounts,cards:[],transactions:[],installmentGroups:[],recurringRules:[rule],pots:[],potMovements:[],budgets:[]};
   const generated=generateRecurringTransactions(data,rule,"2026-03-31");
   const stored=generated.data.recurringRules[0];
   const updated={...stored,amountCents:200000,description:"Salário ajustado",status:"RECEIVED" as const};
   const next=applyRecurringRuleToFutureTransactions(generated.data,stored,updated,"2026-02-01");
   expect(next.transactions.map(t=>({date:t.date,amount:t.amountCents,status:t.status,description:t.description}))).toEqual([
     {date:"2026-01-31",amount:100000,status:"PLANNED",description:"Aluguel"},
     {date:"2026-02-28",amount:200000,status:"RECEIVED",description:"Salário ajustado"},
     {date:"2026-03-31",amount:200000,status:"RECEIVED",description:"Salário ajustado"},
   ]);
 });
 it("allows editing a rule before its first generation",()=>{
   const rule=createRecurringRule(base);
   expect(()=>validateRecurringRuleUpdate(rule,{...rule,amountCents:200000})).not.toThrow();
 });
});
