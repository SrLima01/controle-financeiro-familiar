import { describe, expect, it } from "vitest";
import { createRecurringRule, generateRecurringTransactions, nextRecurringDate, validateRecurringRuleUpdate } from "./recurring-engine";
import type { EntityCollection } from "../../infrastructure/persistence/repository";

const accounts=[{id:"a",name:"Conta",type:"CHECKING" as const,openingBalanceCents:0,active:true}];
const base={description:"Aluguel",frequency:"MONTHLY" as const,startDate:"2026-01-31",amountCents:100000,type:"EXPENSE" as const,status:"PLANNED" as const,accountId:"a",active:true};

describe("recurring engine",()=>{
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
 it("does not generate beyond end date",()=>{
   const rule=createRecurringRule({...base,endDate:"2026-02-28"});
   const data:EntityCollection={people:[],categories:[],accounts,cards:[],transactions:[],installmentGroups:[],recurringRules:[rule],pots:[],potMovements:[],budgets:[]};
   expect(generateRecurringTransactions(data,rule,"2026-12-31").generated).toHaveLength(2);
 });
 it("rejects editing a rule after transactions were generated",()=>{\n   const rule=createRecurringRule(base);\n   const data:EntityCollection={people:[],categories:[],accounts,cards:[],transactions:[],installmentGroups:[],recurringRules:[rule],pots:[],potMovements:[],budgets:[]};\n   const generated=generateRecurringTransactions(data,rule,"2026-01-31");\n   const stored=generated.data.recurringRules[0];\n   expect(()=>validateRecurringRuleUpdate(stored,{...stored,amountCents:200000})).toThrow("generated transactions");\n });\n it("allows editing a rule before its first generation",()=>{\n   const rule=createRecurringRule(base);\n   expect(()=>validateRecurringRuleUpdate(rule,{...rule,amountCents:200000})).not.toThrow();\n });\n});
