import { describe,it,expect } from "vitest";
import { analyzeFinances } from "./assistant-engine";
const base:any={people:[],categories:[{id:"c",name:"Casa",kind:"EXPENSE",active:true}],accounts:[],cards:[],transactions:[],installmentGroups:[],recurringRules:[],pots:[],potMovements:[],budgets:[]};
describe("assistant-engine",()=>{it("ignora pendentes no resultado realizado",()=>{const r=analyzeFinances({...base,transactions:[{id:"1",description:"x",type:"EXPENSE",status:"PENDING",amountCents:1000,date:"2026-09-10",categoryId:"c"}]},"2026-09");expect(r.insights[0].title).toContain("Ainda não há");});});
