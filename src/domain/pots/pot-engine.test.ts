import {describe,expect,it} from "vitest";
import {createPot,getFreeCash,getPotBalance,getTotalReserved,createPotMovement} from "./pot-engine";
const data={people:[],categories:[],accounts:[],cards:[],transactions:[],installmentGroups:[],recurringRules:[],pots:[{id:"p",name:"Obra",targetCents:200000,active:true}],potMovements:[]};
describe("pot engine",()=>{
 it("derives balance from movements",()=>{const d=createPotMovement(data,{potId:"p",type:"DEPOSIT",amountCents:120000,date:"2026-09-29",description:"Reserva"});expect(getPotBalance("p",d)).toBe(120000);expect(getTotalReserved(d)).toBe(120000);expect(getFreeCash(500000,d)).toBe(380000)});
 it("does not allow withdrawal above pot balance",()=>{expect(()=>createPotMovement(data,{potId:"p",type:"WITHDRAWAL",amountCents:1,date:"2026-09-29",description:"Resgate"})).toThrow()});
});
