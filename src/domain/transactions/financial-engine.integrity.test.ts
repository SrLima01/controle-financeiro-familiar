import {describe,expect,it} from "vitest";
import {validateTransaction} from "./financial-engine";
const base={accounts:[{id:"a1",name:"Banco",type:"CHECKING" as const,openingBalanceCents:10000,active:true}],cards:[{id:"card1",name:"Visa",accountId:"a1",creditLimitCents:100000,closingDay:10,dueDay:20,active:true}],transactions:[],categories:[{id:"c1",name:"Mercado",kind:"EXPENSE" as const,active:true}],people:[{id:"p1",name:"João",active:true}]};
const tx=(extra:any)=>({id:"t1",date:"2026-09-29",type:"EXPENSE" as const,status:"PAID" as const,amountCents:1000,description:"Mercado",accountId:"a1",...extra});
describe("transaction integrity",()=>{
 it("rejects zero amount",()=>expect(()=>validateTransaction(tx({amountCents:0}),base)).toThrow());
 it("rejects empty description",()=>expect(()=>validateTransaction(tx({description:"   "}),base)).toThrow());
 it("rejects unknown person",()=>expect(()=>validateTransaction(tx({personId:"missing"}),base)).toThrow());
 it("rejects unknown category",()=>expect(()=>validateTransaction(tx({categoryId:"missing"}),base)).toThrow());
 it("rejects destination on non-transfer",()=>expect(()=>validateTransaction(tx({destinationAccountId:"a1"}),base)).toThrow());
 it("accepts a card payment linked to the card",()=>expect(()=>validateTransaction(tx({type:"CARD_PAYMENT",accountId:"a1",creditCardId:"card1",categoryId:undefined}),base)).not.toThrow());
 it("rejects changing the account of a realized transaction",()=>{
   const previous=tx({accountId:"a1"});
   const next=tx({accountId:"a2"});
   const data={...base,accounts:[...base.accounts,{id:"a2",name:"Outro banco",type:"CHECKING" as const,openingBalanceCents:0,active:true}]};
   expect(()=>validateTransactionUpdate(previous,next,data)).toThrow("cannot change its account");
 });
 it("rejects changing the card of a realized card purchase",()=>{
   const previous=tx({creditCardId:"card1",accountId:undefined});
   const next=tx({creditCardId:"card2",accountId:undefined});
   const data={...base,cards:[...base.cards,{id:"card2",name:"Master",accountId:"a1",creditLimitCents:50000,closingDay:15,dueDay:25,active:true}]};
   expect(()=>validateTransactionUpdate(previous,next,data)).toThrow("cannot change its credit card");
 });
 it("allows changing references of a pending transaction",()=>{
   const previous=tx({status:"PENDING",accountId:"a1"});
   const next=tx({status:"PENDING",accountId:"a2"});
   const data={...base,accounts:[...base.accounts,{id:"a2",name:"Outro banco",type:"CHECKING" as const,openingBalanceCents:0,active:true}]};
   expect(()=>validateTransactionUpdate(previous,next,data)).not.toThrow();
 });
 it("rejects changing a transfer destination after realization",()=>{
   const previous=tx({type:"TRANSFER",accountId:"a1",destinationAccountId:"a2"});
   const next=tx({type:"TRANSFER",accountId:"a1",destinationAccountId:"a3"});
   const data={...base,accounts:[...base.accounts,{id:"a2",name:"Destino",type:"CHECKING" as const,openingBalanceCents:0,active:true},{id:"a3",name:"Outro destino",type:"CHECKING" as const,openingBalanceCents:0,active:true}]};
   expect(()=>validateTransactionUpdate(previous,next,data)).toThrow("cannot change its destination");
 });
 it("rejects expense category on income",()=>expect(()=>validateTransaction({...tx({type:"INCOME",status:"RECEIVED"}),categoryId:"c1",accountId:"a1"},base)).toThrow());
});
