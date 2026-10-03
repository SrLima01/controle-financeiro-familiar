import type { EntityCollection } from "../../infrastructure/persistence/repository";
import type { Pot, PotMovement } from "../types/entities";
import { assertFinancialDate } from "../date/financial-date";
import { assertNonNegativeCents } from "../money/cents";

export function getPotBalance(potId:string,data:EntityCollection):number{
  return data.potMovements.filter(m=>m.potId===potId).reduce((sum,m)=>sum+(m.type==="DEPOSIT"?m.amountCents:-m.amountCents),0);
}
export function getTotalReserved(data:EntityCollection):number{
  return data.pots.filter(p=>p.active).reduce((sum,p)=>sum+Math.max(0,getPotBalance(p.id,data)),0);
}
export function getFreeCash(realBalanceCents:number,data:EntityCollection):number{
  return realBalanceCents-getTotalReserved(data);
}
export function createPot(name:string,targetCents:number):Pot{
  if(!name.trim())throw new Error("Informe o nome da caixinha.");
  assertNonNegativeCents(targetCents,"targetCents");
  return {id:crypto.randomUUID(),name:name.trim(),targetCents,active:true};
}
export function createPotMovement(data:EntityCollection,input:Omit<PotMovement,"id">,realBalanceCents:number):EntityCollection{
  const pot=data.pots.find(p=>p.id===input.potId&&p.active); if(!pot)throw new Error("Caixinha não encontrada.");
  assertFinancialDate(input.date); if(!input.description.trim())throw new Error("Informe uma descrição.");
  if(!Number.isSafeInteger(input.amountCents)||input.amountCents<=0)throw new Error("O valor do movimento deve ser maior que zero.");
  const current=getPotBalance(pot.id,data);
  if(input.type==="WITHDRAWAL"&&input.amountCents>current)throw new Error("O resgate não pode ser maior que o saldo da caixinha.");
  if(input.type==="DEPOSIT" && input.amountCents>getFreeCash(realBalanceCents,data)) throw new Error("O valor excede o dinheiro livre disponível.");
  const movement:PotMovement={...input,id:crypto.randomUUID(),description:input.description.trim()};
  return {...data,potMovements:[...data.potMovements,movement]};
}
export function archivePot(data:EntityCollection,potId:string):EntityCollection{
  const pot=data.pots.find(p=>p.id===potId);
  if(!pot)throw new Error("Caixinha não encontrada.");
  if(getPotBalance(pot.id,data)>0)throw new Error("Não é possível arquivar uma caixinha com saldo. Resgate o valor antes de arquivar.");
  return {...data,pots:data.pots.map(p=>p.id===potId?{...p,active:false}:p)};
}
