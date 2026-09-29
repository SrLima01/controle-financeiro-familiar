import {describe,expect,it} from "vitest";
import {validateTransaction} from "./financial-engine";
const base={accounts:[{id:"a1",name:"Banco",type:"CHECKING" as const,openingBalanceCents:10000,active:true}],cards:[],transactions:[],categories:[{id:"c1",name:"Mercado",kind:"EXPENSE" as const,active:true}],people:[{id:"p1",name:"João",active:true}]};
const tx=(extra:any)=>({id:"t1",date:"2026-09-29",type:"EXPENSE" as const,status:"PAID" as const,amountCents:1000,description:"Mercado",accountId:"a1",...extra});
describe("transaction integrity",()=>{
 it("rejects zero amount",()=>expect(()=>validateTransaction(tx({amountCents:0}),base)).toThrow());
 it("rejects empty description",()=>expect(()=>validateTransaction(tx({description:"   "}),base)).toThrow());
 it("rejects unknown person",()=>expect(()=>validateTransaction(tx({personId:"missing"}),base)).toThrow());
 it("rejects unknown category",()=>expect(()=>validateTransaction(tx({categoryId:"missing"}),base)).toThrow());
 it("rejects destination on non-transfer",()=>expect(()=>validateTransaction(tx({destinationAccountId:"a1"}),base)).toThrow());
 it("rejects expense category on income",()=>expect(()=>validateTransaction({...tx({type:"INCOME",status:"RECEIVED"}),categoryId:"c1",accountId:"a1"},base)).toThrow());
});
