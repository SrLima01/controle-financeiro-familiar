import type { CreditCard, Transaction } from "../types/entities";
import { assertCents } from "../money/cents";
import { assertFinancialDate } from "../date/financial-date";

export type CardInvoice = {
  cardId:string;
  closingDate:string;
  dueDate:string;
  purchaseTotalCents:number;
  paymentTotalCents:number;
  openAmountCents:number;
};

function dateParts(date:string){assertFinancialDate(date);const [y,m,d]=date.split("-").map(Number);return {y,m,d}}
function daysInMonth(y:number,m:number){return new Date(y,m,0).getDate()}
function iso(y:number,m:number,d:number){const mm=String(m).padStart(2,"0"),dd=String(Math.min(d,daysInMonth(y,m))).padStart(2,"0");return `${y}-${mm}-${dd}`}
export function invoiceClosingDate(purchaseDate:string,closingDay:number):string{
 const {y,m,d}=dateParts(purchaseDate); if(!Number.isInteger(closingDay)||closingDay<1||closingDay>31)throw new Error("Invalid closing day");
 if(d<=closingDay)return iso(y,m,closingDay); return iso(m===12?y+1:y,m===12?1:m+1,closingDay);
}
export function invoiceDueDateFromClosing(closingDate:string,closingDay:number,dueDay:number):string{
 const {y,m}=dateParts(closingDate); if(!Number.isInteger(dueDay)||dueDay<1||dueDay>31)throw new Error("Invalid due day");
 const nextMonth=dueDay<=closingDay; const targetM=nextMonth?(m===12?1:m+1):m; const targetY=nextMonth?(m===12?y+1:y):y;
 return iso(targetY,targetM,dueDay);
}
export function getCardInvoice(card:CreditCard,transactions:readonly Transaction[],referenceDate:string):CardInvoice{
 const {y,m}=dateParts(referenceDate);
 const closing=invoiceClosingDate(iso(y,m,1),card.closingDay);
 const cycleClosing = dateParts(closing).d===1 && card.closingDay>1 ? iso(m===1?y-1:y,m===1?12:m-1,card.closingDay) : closing;
 const closeParts=dateParts(cycleClosing);
 const previousClose=iso(closeParts.m===1?closeParts.y-1:closeParts.y,closeParts.m===1?12:closeParts.m-1,card.closingDay);
 const due=invoiceDueDateFromClosing(cycleClosing,card.closingDay,card.dueDay);
 let purchases=0,payments=0;
 for(const tx of transactions){
   if(tx.status==="CANCELLED"||tx.creditCardId!==card.id)continue;
   if(tx.type==="EXPENSE" && tx.date>previousClose && tx.date<=cycleClosing) purchases+=tx.amountCents;
   if(tx.type==="CARD_PAYMENT" && tx.date>=previousClose && tx.date<=due) payments+=tx.amountCents;
 }
 const open=purchases-payments; assertCents(purchases);assertCents(payments);assertCents(open);
 return {cardId:card.id,closingDate:cycleClosing,dueDate:due,purchaseTotalCents:purchases,paymentTotalCents:payments,openAmountCents:open};
}
export function calculateCardOutstanding(card:CreditCard,transactions:readonly Transaction[]):number{
 let total=0;for(const tx of transactions)if(tx.status!=="CANCELLED"&&tx.creditCardId===card.id&&tx.type==="EXPENSE")total+=tx.amountCents;
 for(const tx of transactions)if(tx.status!=="CANCELLED"&&tx.creditCardId===card.id&&tx.type==="CARD_PAYMENT")total-=tx.amountCents;
 assertCents(total,"cardOutstanding");return Math.max(0,total);
}
export function calculateCardAvailableLimit(card:CreditCard,transactions:readonly Transaction[]):number{
 const available=card.creditLimitCents-calculateCardOutstanding(card,transactions);assertCents(available,"cardAvailableLimit");return available;
}