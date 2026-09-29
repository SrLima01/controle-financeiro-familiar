import { describe, expect, it } from "vitest";
import { calculateCardAvailableLimit, calculateCardOutstanding, getCardInvoice, invoiceClosingDate, invoiceDueDateFromClosing } from "./card-engine";
import type { CreditCard, Transaction } from "../types/entities";

const card:CreditCard={id:"c1",name:"Visa",accountId:"a1",creditLimitCents:100000,closingDay:10,dueDay:20,active:true};

describe("card engine",()=>{
 it("places purchases on the correct closing cycle",()=>{
  expect(invoiceClosingDate("2026-09-10",10)).toBe("2026-09-10");
  expect(invoiceClosingDate("2026-09-11",10)).toBe("2026-10-10");
  expect(invoiceDueDateFromClosing("2026-09-10",10,20)).toBe("2026-09-20");
  const tx:Transaction[]=[{id:"1",date:"2026-09-11",type:"EXPENSE",status:"PAID",amountCents:25000,description:"Compra",creditCardId:"c1"}];
  expect(getCardInvoice(card,tx,"2026-09-12").purchaseTotalCents).toBe(25000);
 });
 it("calculates outstanding and available limit",()=>{
  const tx:Transaction[]=[
   {id:"1",date:"2026-09-05",type:"EXPENSE",status:"PAID",amountCents:30000,description:"Compra",creditCardId:"c1"},
   {id:"2",date:"2026-09-06",type:"CARD_PAYMENT",status:"PAID",amountCents:10000,description:"Pagamento",accountId:"a1",creditCardId:"c1"}
  ];
  expect(calculateCardOutstanding(card,tx)).toBe(20000);
  expect(calculateCardAvailableLimit(card,tx)).toBe(80000);
 });
});
