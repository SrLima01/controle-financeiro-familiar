import {describe,expect,it} from "vitest";
import type { EntityCollection } from "../../infrastructure/persistence/repository";
import {archivePot,createPot,getFreeCash,getPotBalance,getTotalReserved,createPotMovement} from "./pot-engine";
const data: EntityCollection = {people:[],categories:[],accounts:[],cards:[],transactions:[],installmentGroups:[],recurringRules:[],pots:[{id:"p",name:"Obra",targetCents:200000,active:true}],potMovements:[],budgets:[]};
describe("pot engine",()=>{
 it("derives balance from movements",()=>{const d=createPotMovement(data,{potId:"p",type:"DEPOSIT",amountCents:120000,date:"2026-09-29",description:"Reserva"},500000);expect(getPotBalance("p",d)).toBe(120000);expect(getTotalReserved(d)).toBe(120000);expect(getFreeCash(500000,d)).toBe(380000)});
 it("does not allow withdrawal above pot balance",()=>{expect(()=>createPotMovement(data,{potId:"p",type:"WITHDRAWAL",amountCents:1,date:"2026-09-29",description:"Resgate"},0)).toThrow()});
 it("does not allow archiving a pot with reserved balance",()=>{const d=createPotMovement(data,{potId:"p",type:"DEPOSIT",amountCents:120000,date:"2026-09-29",description:"Reserva"},500000);expect(()=>archivePot(d,"p")).toThrow("Não é possível arquivar uma caixinha com saldo.");});
 it("allows archiving an empty pot",()=>{expect(archivePot(data,"p").pots.find(p=>p.id==="p")?.active).toBe(false);});
});
