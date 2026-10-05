import type { Account, Category, CreditCard, TransactionType } from "../types/entities";

export type SmartDraft = {
  type: TransactionType;
  amountCents: number;
  date: string;
  description: string;
  categoryId?: string;
  accountId?: string;
  destinationAccountId?: string;
  creditCardId?: string;
  confidence: "HIGH"|"MEDIUM"|"LOW";
  warnings: string[];
  needsReview: boolean;
};

function localDateFromOffset(offsetDays:number, base=new Date()): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function parseSmartAmount(value:string): number | null {
  const raw=value.trim().replace(/R\$\s?/gi,"").replace(/\s/g,"");
  if(!raw) return null;
  const lastComma=raw.lastIndexOf(",");
  const lastDot=raw.lastIndexOf(".");
  let normalized=raw;
  if(lastComma>=0 && lastDot>=0) {
    normalized=lastComma>lastDot ? raw.replace(/\./g,"").replace(",",".") : raw.replace(/,/g,"");
  } else if(lastComma>=0) {
    normalized=raw.replace(",",".");
  } else if(lastDot>=0) {
    const decimals=raw.length-lastDot-1;
    normalized=decimals<=2 ? raw : raw.replace(/\./g,"");
  }
  const n=Number(normalized);
  if(!Number.isFinite(n)||n<=0) return null;
  return Math.round(n*100);
}

function findCandidate<T extends {name:string;active:boolean}>(text:string, items:T[]): T|undefined {
  const lower=text.toLocaleLowerCase("pt-BR");
  return items.filter(x=>x.active).sort((a,b)=>b.name.length-a.name.length).find(x=>lower.includes(x.name.toLocaleLowerCase("pt-BR")));
}

export function parseSmartInput(
  text:string,
  context:{categories:Category[];accounts:Account[];cards:CreditCard[]},
  baseDate=new Date()
): SmartDraft {
  const raw=text.trim();
  const lower=raw.toLocaleLowerCase("pt-BR");
  const warnings:string[]=[];
  const amountMatch=raw.match(/(?:r\$\s*)?\d{1,3}(?:[. ]\d{3})*(?:,\d{2})?(?:\.\d{2})?|(?:r\$\s*)?\d+(?:[\.,]\d{1,2})?/i);
  const amountCents=amountMatch?parseSmartAmount(amountMatch[0]):null;
  if(amountCents===null) throw new Error("Não consegui identificar um valor. Ex.: “Paguei 150 no mercado ontem”.");

  let date=localDateFromOffset(0,baseDate);
  let dateWasExplicit=false;
  if(/\bhoje\b/i.test(lower)){dateWasExplicit=true;date=localDateFromOffset(0,baseDate);}
  else if(/\banteontem\b/i.test(lower)){dateWasExplicit=true;date=localDateFromOffset(-2,baseDate);}
  else if(/\bontem\b/i.test(lower)){dateWasExplicit=true;date=localDateFromOffset(-1,baseDate);}
  else {
    const dm=raw.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
    if(dm){
      dateWasExplicit=true;
      const year=dm[3]?Number(dm[3].length===2?"20"+dm[3]:dm[3]):baseDate.getFullYear();
      const candidate=new Date(year,Number(dm[2])-1,Number(dm[1]));
      if(candidate.getFullYear()!==year||candidate.getMonth()!==Number(dm[2])-1||candidate.getDate()!==Number(dm[1])) warnings.push("A data informada parece inválida.");
      else date=year+"-"+String(Number(dm[2])).padStart(2,"0")+"-"+String(Number(dm[1])).padStart(2,"0");
    }
  }
  if(!dateWasExplicit) warnings.push("Não identifiquei a data. Confirme se é hoje ou escolha outra data antes de salvar.");

  let type:TransactionType="EXPENSE";
  if(/\b(recebi|recebemos|entrou|salário|salario|ganhei|vendi|receita)\b/i.test(lower)) type="INCOME";
  else if(/\b(transferi|transferência|transferencia|movi|enviei.*para|passei.*para)\b/i.test(lower)) type="TRANSFER";
  else if(/\b(paguei.*fatura|paguei.*cart[aã]o|pagamento.*cart[aã]o)\b/i.test(lower)) type="CARD_PAYMENT";

  const card=findCandidate(raw,context.cards);
  const account=findCandidate(raw,context.accounts);
  const category=findCandidate(raw,context.categories.filter(c=>c.kind===(type==="INCOME"?"INCOME":"EXPENSE")));

  let destinationAccountId:string|undefined;
  if(type==="TRANSFER"){
    const transferMatch=raw.match(/\b(?:para|à|a)\s+(.+?)(?:\s+(?:ontem|anteontem|hoje)\b|$)/i);
    const destination=transferMatch?findCandidate(transferMatch[1],context.accounts):undefined;
    if(destination) destinationAccountId=destination.id;
    else warnings.push("Não identifiquei a conta de destino da transferência.");
    if(account && destinationAccountId===account.id) warnings.push("A conta de origem e destino não podem ser a mesma.");
  }

  if(type==="EXPENSE" && !card && !account) warnings.push("Selecione a conta ou o cartão usado.");
  if(type==="INCOME" && !account) warnings.push("Selecione a conta que recebeu o dinheiro.");
  if(type==="TRANSFER" && !account) warnings.push("Selecione a conta de origem.");
  if(type==="CARD_PAYMENT") warnings.push("Pagamento de cartão exige escolha da conta de pagamento e do cartão.");
  if(!category && (type==="INCOME"||type==="EXPENSE")) warnings.push("Categoria não identificada; escolha uma antes de confirmar.");

  const words=raw.replace(amountMatch?.[0]??"","").replace(/\b(hoje|ontem|anteontem)\b/gi,"").trim();
  const description=words.replace(/^\s*(paguei|pague|gastei|comprei|recebi|receba|ganhei|transferi|enviei|movi|paguei)\s+/i,"").trim() || (type==="INCOME"?"Entrada identificada":"Lançamento identificado");
  const confidence=warnings.length===0?"HIGH":warnings.length<=1?"MEDIUM":"LOW";

  return {type,amountCents,date,description,categoryId:category?.id,accountId:account?.id,destinationAccountId,creditCardId:card?.id,confidence,warnings,needsReview:true};
}
