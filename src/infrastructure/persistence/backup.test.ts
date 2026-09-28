import { describe, expect, it } from "vitest";
import { parseBackup, serializeBackup, emptyEntityCollection } from "./backup";

describe("backup", () => {
  it("round-trips a valid empty backup", () => {
    const parsed = parseBackup(serializeBackup(emptyEntityCollection()));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.data.transactions).toEqual([]);
  });
  it("rejects malformed JSON", () => expect(() => parseBackup("{")).toThrow());
  it("rejects duplicate ids", () => {
    const data = emptyEntityCollection();
    data.people = [{id:"p1",name:"A",active:true},{id:"p1",name:"B",active:true}];
    expect(() => parseBackup(serializeBackup(data))).toThrow(/Duplicate id/);
  });
  it("rejects unknown card account", () => {
    const data = emptyEntityCollection();
    data.cards = [{id:"c1",name:"Card",accountId:"missing",creditLimitCents:10000,closingDay:10,dueDay:20,active:true}];
    expect(() => parseBackup(serializeBackup(data))).toThrow(/unknown account/);
  });
});