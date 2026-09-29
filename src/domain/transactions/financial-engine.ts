import type{Account,CreditCard,Transaction,TransactionStatus,Category,Person}from"../types/entities";import{assertCents,assertNonNegativeCents}from"../money/cents";import{assertFinancialDate}from"../date/financial-date";
export type FinancialData={accounts:readonly Account[];cards?:readonly CreditCard[];transactions:readonly Transaction[];categories?:readonly Category[];people?:readonly Person[]};
const real=(s:TransactionStatus)=>s==="PAID"||s==="RECEIVED";
const hasAccount=(as:readonly Account[],id:string)=>as.some(a=>a.id===id);
const hasCard=(cs:readonly CreditCard[],id:string)=>cs.some(c=>c.id===id);
const hasId=(items:readonly {id:string}[],id:string)=>items.some(x=>x.id===id);
export function validateTransaction(tx:Transaction,data:FinancialData):void{
 if(!tx.id)throw new Error("Transaction id is required");
 assertFinancialDate(tx.date);
 assertNonNegativeCents(tx.amountCents);
 if(tx.amountCents<=0)throw new Error("Transaction amount must be greater than zero");
 if(!tx.description.trim())throw new Error("Transaction description is required");
 if(tx.personId&&data.people&&!hasId(data.people,tx.personId))throw new Error("Invalid personId");
 if(tx.categoryId&&data.categories&&!hasId(data.categories,tx.categoryId))throw new Error("Invalid categoryId");
 if((tx.type==="INCOME"||tx.type==="EXPENSE")&&tx.accountId&&!hasAccount(data.accounts,tx.accountId))throw new Error("Invalid accountId");
 if(tx.type==="INCOME"||tx.type==="EXPENSE"){
   if(tx.type==="EXPENSE"&&tx.creditCardId){
     if(!hasCard(data.cards??[],tx.creditCardId))throw new Error("Invalid creditCardId");
     if(tx.accountId)throw new Error("Card expense cannot also have accountId");
   }else if(!tx.accountId||!hasAccount(data.accounts,tx.accountId))throw new Error("Valid accountId is required");
 }
 if(tx.type==="TRANSFER"){
   if(!tx.accountId||!hasAccount(data.accounts,tx.accountId))throw new Error("Valid source accountId is required");
   if(!tx.destinationAccountId||!hasAccount(data.accounts,tx.destinationAccountId))throw new Error("Valid destination accountId is required");
   if(tx.accountId===tx.destinationAccountId)throw new Error("Transfer accounts must be different");
 }
 if(tx.type==="CARD_PAYMENT"){
   if(!tx.accountId||!hasAccount(data.accounts,tx.accountId))throw new Error("Valid payment accountId is required");
   if(!tx.creditCardId||!hasCard(data.cards??[],tx.creditCardId))throw new Error("Valid creditCardId is required");
 }
 if(tx.type!=="TRANSFER"&&tx.destinationAccountId)throw new Error("Only transfers may reference destinationAccountId");
 if(tx.type!=="EXPENSE"&&tx.type!=="CARD_PAYMENT"&&tx.creditCardId)throw new Error("Only expenses and card payments may reference a credit card");
 if(tx.type==="INCOME"&&(tx.categoryId&&data.categories?.find(c=>c.id===tx.categoryId)?.kind==="EXPENSE"))throw new Error("Income cannot use an expense category");
 if(tx.type==="EXPENSE"&&(tx.categoryId&&data.categories?.find(c=>c.id===tx.categoryId)?.kind==="INCOME"))throw new Error("Expense cannot use an income category");
}
export function validateAllTransactions(data:FinancialData):void{for(const tx of data.transactions)validateTransaction(tx,data)}
function apply(tx:Transaction,id:string,b:number):number{if(tx.type==="INCOME"&&tx.accountId===id)return b+tx.amountCents;if(tx.type==="EXPENSE"&&tx.accountId===id)return b-tx.amountCents;if(tx.type==="TRANSFER"){if(tx.accountId===id)b-=tx.amountCents;if(tx.destinationAccountId===id)b+=tx.amountCents}if(tx.type==="CARD_PAYMENT"&&tx.accountId===id)b-=tx.amountCents;return b}
export function calculateAccountBalance(accountId:string,data:FinancialData):number{const a=data.accounts.find(x=>x.id===accountId);if(!a)throw new Error("Unknown accountId");validateAllTransactions(data);let b=a.openingBalanceCents;for(const tx of data.transactions)if(real(tx.status))b=apply(tx,accountId,b);assertCents(b,"accountBalance");return b}
export function calculateProjectedAccountBalance(accountId:string,data:FinancialData):number{const a=data.accounts.find(x=>x.id===accountId);if(!a)throw new Error("Unknown accountId");validateAllTransactions(data);let b=a.openingBalanceCents;for(const tx of data.transactions)if(tx.status!=="CANCELLED")b=apply(tx,accountId,b);assertCents(b,"projectedAccountBalance");return b}
export function calculateTotalRealBalance(data:FinancialData):number{return data.accounts.filter(a=>a.active).reduce((s,a)=>s+calculateAccountBalance(a.id,data),0)}
