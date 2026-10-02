import type { EntityCollection } from "../../infrastructure/persistence/repository";

export type Insight={kind:"positive"|"attention"|"info";title:string;detail:string};
export type AssistantAnalysis={insights:Insight[]};

const realized=(t:{status:string})=>t.status==="PAID"||t.status==="RECEIVED";
export function analyzeFinances(data:EntityCollection,month:string):AssistantAnalysis{
 const insights:Insight[]=[];
 const expenses=data.transactions.filter(t=>t.type==="EXPENSE"&&realized(t)&&t.status!=="CANCELLED"&&t.date.slice(0,7)===month);
 const income=data.transactions.filter(t=>t.type==="INCOME"&&realized(t)&&t.status!=="CANCELLED"&&t.date.slice(0,7)===month);
 const totalExpense=expenses.reduce((s,t)=>s+t.amountCents,0);
 const totalIncome=income.reduce((s,t)=>s+t.amountCents,0);
 if(totalIncome===0&&totalExpense===0) insights.push({kind:"info",title:"Ainda não há movimentos realizados neste mês",detail:"Registre entradas e despesas pagas/recebidas para gerar análises."});
 else {
  insights.push({kind:totalIncome>=totalExpense?"positive":"attention",title:"Resultado do mês",detail:`Entradas realizadas: R$ ${(totalIncome/100).toFixed(2)} · Despesas realizadas: R$ ${(totalExpense/100).toFixed(2)}.`});
 }
 for(const b of data.budgets.filter(x=>x.active&&x.month===month)){
  const spent=expenses.filter(t=>t.categoryId===b.categoryId).reduce((s,t)=>s+t.amountCents,0);
  const pct=b.limitCents?spent/b.limitCents*100:0;
  const name=data.categories.find(c=>c.id===b.categoryId)?.name??"Categoria";
  if(pct>100) insights.push({kind:"attention",title:`Orçamento excedido: ${name}`,detail:`Gasto realizado de R$ ${(spent/100).toFixed(2)} sobre limite de R$ ${(b.limitCents/100).toFixed(2)}.`});
  else if(pct>=80) insights.push({kind:"attention",title:`Orçamento próximo do limite: ${name}`,detail:`${pct.toFixed(0)}% do orçamento já foi realizado.`});
 }
 const pending=data.transactions.filter(t=>(t.status==="PENDING"||t.status==="PLANNED")&&t.date.slice(0,7)===month);
 const pendingExpense=pending.filter(t=>t.type==="EXPENSE"||t.type==="CARD_PAYMENT").reduce((s,t)=>s+t.amountCents,0);
 const pendingIncome=pending.filter(t=>t.type==="INCOME").reduce((s,t)=>s+t.amountCents,0);
 if(pending.length) insights.push({kind:"info",title:"Há movimentos futuros/pendentes",detail:`Impacto previsto: entradas R$ ${(pendingIncome/100).toFixed(2)} e saídas R$ ${(pendingExpense/100).toFixed(2)}.`});
 const top=new Map<string,number>(); for(const t of expenses) if(t.categoryId) top.set(t.categoryId,(top.get(t.categoryId)||0)+t.amountCents);
 const first=[...top.entries()].sort((a,b)=>b[1]-a[1])[0];
 if(first){const name=data.categories.find(c=>c.id===first[0])?.name??"Categoria";insights.push({kind:"info",title:"Maior categoria de despesa",detail:`${name}: R$ ${(first[1]/100).toFixed(2)} no mês.`});}
 return {insights};
}
