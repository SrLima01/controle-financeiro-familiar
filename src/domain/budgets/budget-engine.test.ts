import {describe,expect,it} from "vitest";
import type { EntityCollection } from "../../infrastructure/persistence/repository";
import {getBudgetSpent,getBudgetStatus} from "./budget-engine";
const budget={id:"b",month:"2026-09",categoryId:"c",limitCents:100000,active:true};
const data: EntityCollection = {people:[],categories:[],accounts:[],cards:[],transactions:[
{id:"1",date:"2026-09-10",type:"EXPENSE",status:"PAID",amountCents:70000,description:"Mercado",categoryId:"c"},
{id:"2",date:"2026-09-20",type:"EXPENSE",status:"PENDING",amountCents:15000,description:"Cartão",categoryId:"c",creditCardId:"card"},
{id:"3",date:"2026-08-20",type:"EXPENSE",status:"PAID",amountCents:90000,description:"Fora do mês",categoryId:"c"},
{id:"4",date:"2026-09-22",type:"EXPENSE",status:"CANCELLED",amountCents:50000,description:"Cancelada",categoryId:"c"}
],installmentGroups:[],recurringRules:[],pots:[],potMovements:[],budgets:[budget]};
describe("budget engine",()=>{
 it("counts only realized expenses by purchase month and excludes cancelled",()=>expect(getBudgetSpent(data,budget)).toBe(70000));
 it("uses 80 and 100 thresholds",()=>{expect(getBudgetStatus(80000,100000)).toBe("ATTENTION");expect(getBudgetStatus(100001,100000)).toBe("EXCEEDED")});
 it("counts a realized card purchase in the budget but never the card payment",()=>{const d={...data,transactions:[...data.transactions,{id:"5",date:"2026-09-05",type:"EXPENSE" as const,status:"PAID" as const,amountCents:30000,description:"Compra cartão",categoryId:"c",creditCardId:"card"},{id:"6",date:"2026-09-20",type:"CARD_PAYMENT" as const,status:"PAID" as const,amountCents:30000,description:"Pagamento fatura",accountId:"account",creditCardId:"card"}]};expect(getBudgetSpent(d,budget)).toBe(100000)});
});
