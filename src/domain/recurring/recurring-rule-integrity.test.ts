import { describe, expect, it } from "vitest";
import { createRecurringRule, validateRecurringRuleUpdate } from "./recurring-engine";

const base={
  description:"Aluguel",
  frequency:"MONTHLY" as const,
  startDate:"2026-01-10",
  amountCents:100000,
  type:"EXPENSE" as const,
  status:"PLANNED" as const,
  accountId:"a1",
  active:true,
};

describe("recurring rule integrity",()=>{
  it("rejects editing a rule after transactions were generated",()=>{
    const previous={...createRecurringRule(base),transactionIds:["tx-1"]};
    const next={...previous,amountCents:120000};
    expect(()=>validateRecurringRuleUpdate(previous,next)).toThrow("generated transactions");
  });

  it("allows editing a rule before any transaction is generated",()=>{
    const previous=createRecurringRule(base);
    const next={...previous,amountCents:120000,description:"Aluguel atualizado"};
    expect(()=>validateRecurringRuleUpdate(previous,next)).not.toThrow();
  });

  it("does not allow changing rule identity or generated history metadata",()=>{
    const previous=createRecurringRule(base);
    expect(()=>validateRecurringRuleUpdate(previous,{...previous,id:"other"})).toThrow("id cannot change");
    expect(()=>validateRecurringRuleUpdate(previous,{...previous,transactionIds:["tx-1"]})).toThrow("history cannot change");
  });
});
