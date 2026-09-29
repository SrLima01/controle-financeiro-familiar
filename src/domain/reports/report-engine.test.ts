import {describe,expect,it} from "vitest";import {expensesByCategory,monthlyExpenses,cashFlow} from "./report-engine";
const data={people:[],categories:[{id:"c",name:"Mercado",kind:"EXPENSE",active:true}],accounts:[],cards:[],transactions:[
{id:"1",date:"2026-09-01",type:"EXPENSE",status:"PAID",amountCents:1000,description:"x",categoryId:"c"},
{id:"2",date:"2026-09-02",type:"EXPENSE",status:"CANCELLED",amountCents:9000,description:"x",categoryId:"c"},
{id:"3",date:"2026-09-03",type:"INCOME",status:"RECEIVED",amountCents:5000,description:"x"}],installmentGroups:[],recurringRules:[],pots:[],potMovements:[],budgets:[]};
describe("reports",()=>{it("excludes cancelled",()=>expect(expensesByCategory(data,"2026-09")[0].amountCents).toBe(1000));it("groups months",()=>expect(monthlyExpenses(data)[0].month).toBe("2026-09"));it("calculates cash flow excluding transfers",()=>expect(cashFlow(data,"2026-09").netCents).toBe(4000))});
