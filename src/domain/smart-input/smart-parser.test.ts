import { describe, expect, it } from "vitest";
import { parseSmartAmount, parseSmartInput } from "./smart-parser";

const categories=[{id:"mercado",name:"Mercado",kind:"EXPENSE" as const,active:true},{id:"salario",name:"Salário",kind:"INCOME" as const,active:true}];
const accounts=[{id:"corrente",name:"Conta Corrente",type:"CHECKING" as const,openingBalanceCents:0,active:true},{id:"poupanca",name:"Poupança",type:"SAVINGS" as const,openingBalanceCents:0,active:true}];
const cards=[{id:"visa",name:"Visa",accountId:"corrente",creditLimitCents:100000,closingDay:10,dueDay:20,active:true}];

describe("smart parser",()=>{
 it("interpreta valor em formatos brasileiros sem ambiguidade",()=>{
   expect(parseSmartAmount("150")).toBe(15000);
   expect(parseSmartAmount("150,50")).toBe(15050);
   expect(parseSmartAmount("1.250,50")).toBe(125050);
   expect(parseSmartAmount("12.34")).toBe(1234);
 });
 it("interpreta despesa, data e categoria",()=>{
   const base=new Date(2026,8,29);
   const d=parseSmartInput("Paguei 150 no Mercado ontem", {categories,accounts,cards}, base);
   expect(d.type).toBe("EXPENSE");
   expect(d.amountCents).toBe(15000);
   expect(d.date).toBe("2026-09-28");
   expect(d.categoryId).toBe("mercado");
   expect(d.needsReview).toBe(true);
 });
 it("não inventa conta quando a origem está ausente",()=>{
   const d=parseSmartInput("Recebi 2500 do salário hoje", {categories,accounts:[],cards}, new Date(2026,8,29));
   expect(d.accountId).toBeUndefined();
   expect(d.warnings).toContain("Selecione a conta que recebeu o dinheiro.");
 });
 it("reconhece transferência entre contas",()=>{
   const d=parseSmartInput("Transferi 300 da Conta Corrente para a Poupança", {categories,accounts,cards}, new Date(2026,8,29));
   expect(d.type).toBe("TRANSFER");
   expect(d.accountId).toBe("corrente");
   expect(d.destinationAccountId).toBe("poupanca");
 });
});
