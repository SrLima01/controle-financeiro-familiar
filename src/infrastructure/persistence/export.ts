import type { EntityCollection } from "./repository";
import { parseBackup, serializeBackup } from "./backup";

export function downloadText(filename:string,textValue:string,mime="application/json;charset=utf-8"){
 const blob=new Blob([textValue],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}
export function exportJson(data:EntityCollection){downloadText("controle-financeiro-backup.json",serializeBackup(data));}
function csvCell(value:unknown){return '"' + String(value ?? "").replaceAll('"','""') + '"';}
export function exportTransactionsCsv(data:EntityCollection){
 const rows: unknown[][]=[["Data","Tipo","Status","Descrição","Valor (centavos)","Categoria","Conta","Cartão","Pessoa"]];
 for(const t of data.transactions) rows.push([t.date,t.type,t.status,t.description,t.amountCents,data.categories.find(c=>c.id===t.categoryId)?.name??"",data.accounts.find(a=>a.id===t.accountId)?.name??"",data.cards.find(c=>c.id===t.creditCardId)?.name??"",data.people.find(p=>p.id===t.personId)?.name??""]);
 downloadText("transacoes.csv",rows.map(r=>r.map(csvCell).join(";")).join("\n"),"text/csv;charset=utf-8");
}
export function importJson(text:string):EntityCollection{return parseBackup(text).data;}
