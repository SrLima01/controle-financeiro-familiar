import { describe, expect, it } from "vitest";
import { extractReceiptDate, extractReceiptMerchant, extractReceiptTotal } from "./receipt-ocr";

describe("receipt OCR extraction",()=>{
  it("extracts total only from explicit total lines",()=>{
    const text="SUPERMERCADO EXEMPLO\nARROZ 25,90\nTOTAL R$ 150,50";
    expect(extractReceiptTotal(text)).toBe(15050);
  });
  it("extracts a valid Brazilian date",()=>{
    expect(extractReceiptDate("29/09/2026 18:32")).toBe("2026-09-29");
    expect(extractReceiptDate("31/02/2026")).toBeNull();
  });
  it("uses an early textual line as merchant candidate without treating totals as merchant",()=>{
    expect(extractReceiptMerchant("SUPERMERCADO EXEMPLO\nCNPJ 00.000.000/0001-00\nTOTAL R$ 10,00")).toBe("SUPERMERCADO EXEMPLO");
  });
  it("does not invent a total when OCR has no total marker",()=>{
    expect(extractReceiptTotal("SUPERMERCADO\nARROZ 25,90\nCAFE 12,00")).toBeNull();
  });
});
