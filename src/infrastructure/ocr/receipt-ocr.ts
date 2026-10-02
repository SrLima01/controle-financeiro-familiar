import { createWorker } from "tesseract.js";

export type ReceiptOcrResult = {
  text: string;
  confidence: number;
};

export async function recognizeReceipt(
  file: Blob,
  onProgress?: (progress:number)=>void
): Promise<ReceiptOcrResult> {
  const worker = await createWorker("por", 1, {
    logger: message => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        onProgress?.(message.progress);
      }
    }
  });
  try {
    const result = await worker.recognize(file);
    return {
      text: result.data.text.trim(),
      confidence: result.data.confidence
    };
  } finally {
    await worker.terminate();
  }
}

export function extractReceiptTotal(text:string): number | null {
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const candidates: number[]=[];
  for(const line of lines){
    if(!/(total|valor\s+a\s+pagar|valor\s+total|total\s+a\s+pagar)/i.test(line)) continue;
    const matches=line.match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?\d+[\.,]\d{2}/gi)??[];
    for(const raw of matches){
      const normalized=raw.replace(/R\$\s?/gi,"").replace(/\./g,"").replace(",",".");
      const n=Number(normalized);
      if(Number.isFinite(n)&&n>0)candidates.push(Math.round(n*100));
    }
  }
  return candidates.length?candidates[candidates.length-1]:null;
}

export function extractReceiptDate(text:string): string | null {
  const match=text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
  if(!match)return null;
  const year=match[3].length===2?Number("20"+match[3]):Number(match[3]);
  const month=Number(match[2]),day=Number(match[1]);
  const d=new Date(year,month-1,day);
  if(d.getFullYear()!==year||d.getMonth()!==month-1||d.getDate()!==day)return null;
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

export function extractReceiptMerchant(text:string): string {
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  return lines.find(line=>/[A-Za-zÀ-ÿ]{3,}/.test(line) && !/^(CNPJ|CPF|DOCUMENTO|CUPOM|DANFE|NFC|SAT|TOTAL|VALOR)/i.test(line)) ?? "";
}
