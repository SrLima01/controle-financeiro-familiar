import type { EntityCollection } from "../../infrastructure/persistence/repository";

export type CategoryExpenseReport={categoryId:string;name:string;amountCents:number};
export type MonthlyExpenseReport={month:string;amountCents:number};
export type PersonExpenseReport={personId:string;name:string;amountCents:number};

function activeExpense(t:{type:string;status:string;amountCents:number}){return t.type==="EXPENSE"&&t.status!=="CANCELLED"}
export function expensesByCategory(data:EntityCollection,month?:string):CategoryExpenseReport[]{
 const map=new Map<string,number>();
 for(const t of data.transactions){if(!activeExpense(t))continue;if(month&&t.date.slice(0,7)!==month)continue;if(!t.categoryId)continue;map.set(t.categoryId,(map.get(t.categoryId)||0)+t.amountCents)}
 return [...map.entries()].map(([categoryId,amountCents])=>({categoryId,name:data.categories.find(c=>c.id===categoryId)?.name??"Categoria removida",amountCents})).sort((a,b)=>b.amountCents-a.amountCents);
}
export function incomeByCategory(data:EntityCollection,month?:string):CategoryExpenseReport[]{
 const map=new Map<string,number>();
 for(const t of data.transactions){if(t.type!=="INCOME"||t.status==="CANCELLED")continue;if(month&&t.date.slice(0,7)!==month)continue;if(!t.categoryId)continue;map.set(t.categoryId,(map.get(t.categoryId)||0)+t.amountCents)}
 return [...map.entries()].map(([categoryId,amountCents])=>({categoryId,name:data.categories.find(c=>c.id===categoryId)?.name??"Categoria removida",amountCents})).sort((a,b)=>b.amountCents-a.amountCents);
}
export function monthlyExpenses(data:EntityCollection):MonthlyExpenseReport[]{
 const map=new Map<string,number>();for(const t of data.transactions){if(!activeExpense(t))continue;const m=t.date.slice(0,7);map.set(m,(map.get(m)||0)+t.amountCents)}
 return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([month,amountCents])=>({month,amountCents}));
}
export function expensesByPerson(data:EntityCollection,month?:string):PersonExpenseReport[]{
 const map=new Map<string,number>();for(const t of data.transactions){if(!activeExpense(t)||!t.personId)continue;if(month&&t.date.slice(0,7)!==month)continue;map.set(t.personId,(map.get(t.personId)||0)+t.amountCents)}
 return [...map.entries()].map(([personId,amountCents])=>({personId,name:data.people.find(p=>p.id===personId)?.name??"Pessoa removida",amountCents})).sort((a,b)=>b.amountCents-a.amountCents);
}
export function cashFlow(data:EntityCollection,month:string){let income=0,expense=0;for(const t of data.transactions){if(t.date.slice(0,7)!==month||t.status==="CANCELLED")continue;if(t.type==="INCOME")income+=t.amountCents;else if(t.type==="EXPENSE")expense+=t.amountCents}return {month,incomeCents:income,expenseCents:expense,netCents:income-expense};}
