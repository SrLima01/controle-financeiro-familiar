import { describe, expect, it } from "vitest";
import { cashFlow, expensesByCategory } from "./report-engine";
import type { EntityCollection } from "../../infrastructure/persistence/repository";

const base:EntityCollection={
 people:[],categories:[{id:"cat",name:"Casa",kind:"EXPENSE",active:true}],accounts:[{id:"acc",name:"Conta",type:"CHECKING",openingBalanceCents:100000,active:true}],cards:[],transactions:[],installmentGroups:[],recurringRules:[],pots:[],potMovements:[],budgets:[]
};

describe("report engine",()=>{
 it("keeps pending out of realized reports but includes it in projected reports",()=>{
  const data={...base,transactions:[
   {id:"1",date:"2026-09-10",type:"EXPENSE" as const,status:"PAID" as const,amountCents:1000,description:"Pago",accountId:"acc",categoryId:"cat"},
   {id:"2",date:"2026-09-11",type:"EXPENSE" as const,status:"PENDING" as const,amountCents:2000,description:"Pendente",accountId:"acc",categoryId:"cat"}
  ]};
  expect(expensesByCategory(data,"2026-09","REALIZED")[0].amountCents).toBe(1000);
  expect(expensesByCategory(data,"2026-09","PROJECTED")[0].amountCents).toBe(3000);
 });
 it("includes card payment as cash outflow without treating it as expense",()=>{
  const data={...base,transactions:[
   {id:"1",date:"2026-09-10",type:"INCOME" as const,status:"RECEIVED" as const,amountCents:10000,description:"Entrada",accountId:"acc"},
   {id:"2",date:"2026-09-11",type:"EXPENSE" as const,status:"PAID" as const,amountCents:2000,description:"Compra",accountId:"acc",categoryId:"cat"},
   {id:"3",date:"2026-09-12",type:"CARD_PAYMENT" as const,status:"PAID" as const,amountCents:3000,description:"Fatura",accountId:"acc",creditCardId:"card"}
  ]};
  expect(cashFlow(data,"2026-09")).toEqual({month:"2026-09",incomeCents:10000,expenseCents:2000,cardPaymentsCents:3000,netCents:5000});
 });
});
