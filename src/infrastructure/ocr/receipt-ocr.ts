import { createWorker } from "tesseract.js";

export type ReceiptOcrResult = {
  text: string;
  confidence: number;
};

async function preprocessReceipt(file: Blob): Promise<Blob> {
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Não foi possível preparar a imagem do recibo."));
      image.src = url;
    });

    const maxWidth = 1800;
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Não foi possível preparar a imagem.");

    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const r = pixels.data[i];
      const g = pixels.data[i + 1];
      const b = pixels.data[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
      pixels.data[i] = contrasted;
      pixels.data[i + 1] = contrasted;
      pixels.data[i + 2] = contrasted;
    }
    ctx.putImageData(pixels, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível converter a imagem.")), "image/jpeg", 0.92);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
    let best: ReceiptOcrResult | null = null;
    const variants: Blob[] = [];
    try { variants.push(await preprocessReceipt(file)); } catch { /* fallback para a foto original */ }
    variants.push(file);

    for (const image of variants) {
      const result = await worker.recognize(image);
      const candidate = {
        text: result.data.text.trim(),
        confidence: result.data.confidence
      };
      if (!best || candidate.confidence > best.confidence || (!best.text && candidate.text)) {
        best = candidate;
      }
      if (candidate.confidence >= 82 && candidate.text.length >= 20) break;
    }

    return best ?? { text: "", confidence: 0 };
  } finally {
    await worker.terminate();
  }
}

function parseMoneyCandidates(text:string): number[] {
  const matches = text.match(/(?:R\$\s*)?\d{1,3}(?:[. ]\d{3})*(?:,\d{2}|\.\d{2})|(?:R\$\s*)?\d+[,.]\d{2}/gi) ?? [];
  return matches.map(raw => {
    const normalized = raw
      .replace(/R\$\s?/gi, "")
      .replace(/\s/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }).filter(Boolean);
}

export function extractReceiptTotal(text:string): number | null {
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const labeled:number[]=[];
  for(const line of lines){
    const normalized=line.toLowerCase().replace(/0/g,"o").replace(/1/g,"i");
    if(!/(total|valor\s*(a|à)?\s*pagar|valor\s*total|vlr\.?\s*total|totai)/i.test(normalized)) continue;
    labeled.push(...parseMoneyCandidates(line));
  }
  if(labeled.length) return labeled[labeled.length-1];

  const all=lines.flatMap(parseMoneyCandidates);
  if(all.length===1) return all[0];
  if(all.length>1) return Math.max(...all);
  return null;
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
  return lines.find(line =>
    /[A-Za-zÀ-ÿ]{3,}/.test(line) &&
    !/^(CNPJ|CPF|DOCUMENTO|CUPOM|DANFE|NFC|SAT|TOTAL|VALOR|DATA|HORA|ENDERE[CÇ]O)/i.test(line) &&
    !/^\d+[\s.-]*$/.test(line)
  ) ?? "";
}
