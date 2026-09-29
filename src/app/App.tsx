import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { archivePerson, createPerson, updatePerson } from "../domain/people/person-engine";
import { archiveCategory, createCategory, updateCategory } from "../domain/categories/category-engine";
import type { User } from "@supabase/supabase-js";
import type { EntityCollection } from "../infrastructure/persistence/repository";
import type { Person, Category } from "../domain/types/entities";
import { IndexedDbFinanceRepository } from "../infrastructure/persistence/indexeddb";
import { calculateProjectedAccountBalance, calculateTotalRealBalance, validateTransaction } from "../domain/transactions/financial-engine";
import { calculateCardAvailableLimit, calculateCardOutstanding, getCardInvoice, validateCreditCard } from "../domain/cards/card-engine";
import { getAuthState, onAuthStateChange, signInWithEmail, signOut, signUpWithEmail } from "../infrastructure/supabase/auth";
import { createFamily, joinFamily, listMyFamilies, type Family } from "../infrastructure/supabase/family";
import { pullFinanceState } from "../infrastructure/supabase/sync";
import { pushFromLocalFirst } from "../infrastructure/supabase/sync-coordinator";
import type { Account, AccountType, CreditCard, Transaction, TransactionStatus, TransactionType } from "../domain/types/entities";
import { assertCents } from "../domain/money/cents";
import { buildInstallmentSet, cancelInstallments, getInstallmentNumber } from "../domain/installments/installment-engine";
import { createRecurringRule, deactivateRecurringRule, generateRecurringTransactions } from "../domain/recurring/recurring-engine";
import { archivePot, createPot, createPotMovement, getFreeCash, getPotBalance, getTotalReserved } from "../domain/pots/pot-engine";
import { createBudget, getBudgetSpent, getBudgetStatus } from "../domain/budgets/budget-engine";
import { cashFlow, expensesByCategory, expensesByPerson, incomeByCategory, monthlyExpenses } from "../domain/reports/report-engine";
import type { Budget, Pot, RecurringFrequency, RecurringRule } from "../domain/types/entities";
import { exportJson, exportTransactionsCsv, importJson } from "../infrastructure/persistence/export";
import { analyzeFinances } from "../domain/assistant/assistant-engine";
import { parseSmartAmount, parseSmartInput, type SmartDraft } from "../domain/smart-input/smart-parser";
import { extractReceiptDate, extractReceiptMerchant, extractReceiptTotal, recognizeReceipt } from "../infrastructure/ocr/receipt-ocr";

type Page = "dashboard" | "contas" | "transacoes" | "cartoes" | "mais" | "relatorios";
const emptyData: EntityCollection = { people: [], categories: [], accounts: [], cards: [], transactions: [], installmentGroups: [], recurringRules: [], pots: [], potMovements: [], budgets: [] };
const repo = new IndexedDbFinanceRepository();

function money(cents:number) {
  return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(cents / 100);
}

function todayFinancialDate() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

function todayMonth() {
  const d = new Date();
  return d.toLocaleDateString("pt-BR", { month:"long", year:"numeric" });
}

function AuthScreen({ onAuthenticated }:{onAuthenticated:(user:User)=>void}) {
  const [mode,setMode] = useState<"login"|"signup">("login");
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function submit(e:FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const result = mode==="login" ? await signInWithEmail(email,password) : await signUpWithEmail(email,password);
      if (result.user) onAuthenticated(result.user);
      else setError("Cadastro realizado. Confirme o e-mail antes de entrar.");
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="panel auth-panel">
    <div className="brand-mark">CF</div><h1>Controle Financeiro Familiar</h1>
    <p className="muted">Suas finanças, com histórico e sincronização familiar.</p>
    <form onSubmit={submit} className="form-stack">
      <label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label>
      <label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} autoComplete={mode==="login"?"current-password":"new-password"}/></label>
      {error && <div className="alert error">{error}</div>}
      <button className="primary" disabled={busy}>{busy ? "Aguarde…" : mode==="login" ? "Entrar" : "Criar conta"}</button>
    </form>
    <button className="link-button" onClick={()=>{setMode(mode==="login"?"signup":"login");setError("")}}>
      {mode==="login" ? "Ainda não tenho conta" : "Já tenho uma conta"}
    </button>
  </section></main>;
}

function FamilyScreen({ user, onReady }:{user:User;onReady:(family:Family)=>void}) {
  const [families,setFamilies]=useState<Family[]>([]);
  const [name,setName]=useState("");
  const [code,setCode]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{ listMyFamilies().then(setFamilies).catch(e=>setError(e instanceof Error?e.message:"Não foi possível carregar as famílias.")); },[]);
  async function create() {
    if (!name.trim()) return;
    setBusy(true);setError("");
    try { const id=await createFamily(name.trim()); const family={id,name:name.trim(),invite_code:"",created_by:user.id,created_at:new Date().toISOString()}; onReady(family); } catch(e){setError(e instanceof Error?e.message:"Não foi possível criar.");} finally{setBusy(false);}
  }
  async function join() {
    if (!code.trim()) return;
    setBusy(true);setError("");
    try { const id=await joinFamily(code.trim().toUpperCase()); const found=(await listMyFamilies()).find(f=>f.id===id); if(found) onReady(found); else setError("Família vinculada, mas não foi possível carregar seus dados."); } catch(e){setError(e instanceof Error?e.message:"Não foi possível entrar.");} finally{setBusy(false);}
  }
  return <main className="auth-page"><section className="panel family-panel">
    <h1>Escolha sua família</h1><p className="muted">A família define o conjunto financeiro que será sincronizado entre os aparelhos.</p>
    {families.length>0 && <div className="family-list">{families.map(f=><button key={f.id} className="family-card" onClick={()=>onReady(f)}><strong>{f.name}</strong><span>Família sincronizada</span></button>)}</div>}
    <div className="split-line"><span>ou</span></div>
    <h2>Criar nova família</h2><div className="inline-form"><input placeholder="Ex.: Nossa casa" value={name} onChange={e=>setName(e.target.value)}/><button className="primary" disabled={busy} onClick={create}>Criar</button></div>
    <h2>Entrar com código</h2><div className="inline-form"><input placeholder="Código de convite" value={code} onChange={e=>setCode(e.target.value)}/><button className="secondary" disabled={busy} onClick={join}>Entrar</button></div>
    {error && <div className="alert error">{error}</div>}
  </section></main>;
}

function Dashboard({data}:{data:EntityCollection}) {
  const real=useMemo(()=>calculateTotalRealBalance({accounts:data.accounts,cards:data.cards,transactions:data.transactions}),[data]);
  const projected=useMemo(()=>data.accounts.filter(a=>a.active).reduce((s,a)=>s+calculateProjectedAccountBalance(a.id,{accounts:data.accounts,cards:data.cards,transactions:data.transactions}),0),[data]);
  const pending=data.transactions.filter(t=>t.status==="PENDING"||t.status==="PLANNED").reduce((s,t)=>s+(t.type==="EXPENSE"||t.type==="CARD_PAYMENT"?-t.amountCents:t.type==="INCOME"?t.amountCents:0),0);
  return <div className="page-content">
    <div className="page-heading"><div><span className="eyebrow">{todayMonth()}</span><h1>Visão geral</h1></div><span className="sync-dot">Local</span></div>
    <section className="hero-card"><span>Saldo total real</span><strong>{money(real)}</strong><small>Somente movimentos pagos/recebidos.</small></section>
    <div className="metric-grid"><article className="metric"><span>Projetado</span><strong>{money(projected)}</strong><small>Considera lançamentos futuros.</small></article><article className="metric"><span>Movimentos pendentes</span><strong>{money(pending)}</strong><small>Impacto ainda não realizado.</small></article></div>
    <section className="panel"><div className="section-title"><h2>Contas</h2><span>{data.accounts.filter(a=>a.active).length} ativas</span></div>
      {data.accounts.filter(a=>a.active).length===0 ? <Empty text="Nenhuma conta cadastrada ainda."/> : <div className="account-list">{data.accounts.filter(a=>a.active).map(a=><div className="account-row" key={a.id}><div><strong>{a.name}</strong><span>{a.type}</span></div><strong>{money(calculateProjectedAccountBalance(a.id,{accounts:data.accounts,cards:data.cards,transactions:data.transactions}))}</strong></div>)}</div>}
    </section>
  </div>;
}

function Empty({text}:{text:string}) { return <div className="empty">{text}</div>; }

function Accounts({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
  const [editing,setEditing]=useState<Account|null>(null);
  const [name,setName]=useState(""); const [type,setType]=useState<AccountType>("CHECKING"); const [opening,setOpening]=useState("");
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  function reset(){setName("");setType("CHECKING");setOpening("");setError("");}
  function edit(a:Account){setEditing(a);setName(a.name);setType(a.type);setOpening((a.openingBalanceCents/100).toFixed(2).replace(".",","));setError("");}
  async function save(){
    setError(""); const value=Number(opening.replace(/\\./g,"").replace(",","."));
    if(!name.trim()||!Number.isFinite(value)||value<0){setError("Informe nome e saldo inicial válido.");return;}
    const cents=Math.round(value*100); try{assertCents(cents,"openingBalanceCents")}catch(e){setError(e instanceof Error?e.message:"Valor inválido.");return;}
    const account:Account={id:editing?.id ?? crypto.randomUUID(),name:name.trim(),type,openingBalanceCents:cents,active:true};
    const next={...data,accounts:editing?data.accounts.map(a=>a.id===account.id?account:a):[...data.accounts,account]};
    setBusy(true);try{await onChange(next);reset();}catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar.");}finally{setBusy(false);}
  }
  async function archive(a:Account){
    if(!confirm("Arquivar a conta \"" + a.name + "\"? O histórico será preservado."))return;
    setBusy(true);setError("");try{await onChange({...data,accounts:data.accounts.map(x=>x.id===a.id?{...x,active:false}:x)});}catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar.");}finally{setBusy(false);}
  }
  return <div className="page-content">
    <div className="page-heading"><div><span className="eyebrow">Patrimônio</span><h1>Contas</h1></div><button className="primary compact" onClick={reset}>+ Nova conta</button></div>
    {error&&<div className="global-alert">{error}</div>}
    <section className="panel account-list">{data.accounts.filter(a=>a.active).length===0?<Empty text="Nenhuma conta ativa. Cadastre a primeira conta para começar."/>:data.accounts.filter(a=>a.active).map(a=><div className="account-row" key={a.id}><div><strong>{a.name}</strong><span>{a.type} · Saldo inicial {money(a.openingBalanceCents)}</span></div><div className="row-actions"><strong>{money(calculateProjectedAccountBalance(a.id,{accounts:data.accounts,cards:data.cards,transactions:data.transactions}))}</strong><button className="link-button" onClick={()=>edit(a)}>Editar</button><button className="link-button danger" onClick={()=>void archive(a)} disabled={busy}>Arquivar</button></div></div>)}</section>
    <section className="panel form-panel"><h2>{editing?"Editar conta":"Nova conta"}</h2>
      <div className="form-grid"><label>Nome<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Banco principal"/></label>
      <label>Tipo<select value={type} onChange={e=>setType(e.target.value as AccountType)}><option value="CHECKING">Conta corrente</option><option value="SAVINGS">Poupança</option><option value="DIGITAL">Conta digital</option><option value="CASH">Dinheiro</option><option value="INVESTMENT">Investimento</option></select></label>
      <label>Saldo inicial<input inputMode="decimal" value={opening} onChange={e=>setOpening(e.target.value)} placeholder="0,00"/></label></div>
      <div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar alterações":"Criar conta"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar</button>}</div>
    </section>
  </div>;
}

function parseAmount(value:string):number{const cents=parseSmartAmount(value);if(cents===null)throw new Error("Informe um valor válido.");assertCents(cents,"amountCents");return cents}

function Transactions({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
 const [editing,setEditing]=useState<Transaction|null>(null);
 const [type,setType]=useState<TransactionType>("EXPENSE");
 const [status,setStatus]=useState<TransactionStatus>("PAID");
 const [date,setDate]=useState(()=>todayFinancialDate());
 const [amount,setAmount]=useState("");
 const [description,setDescription]=useState("");
 const [categoryId,setCategoryId]=useState("");
 const [accountId,setAccountId]=useState("");
 const [destinationAccountId,setDestinationAccountId]=useState("");
 const [creditCardId,setCreditCardId]=useState("");
 const [personId,setPersonId]=useState("");
 const [installments,setInstallments]=useState("2");
 const [parcelado,setParcelado]=useState(false);
 const [filter,setFilter]=useState<"ALL"|"INCOME"|"EXPENSE"|"TRANSFER"|"CARD_PAYMENT">("ALL");
 const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 const activeAccounts=data.accounts.filter(a=>a.active),activeCards=data.cards.filter(c=>c.active),activePeople=data.people.filter(p=>p.active);
 const activeCategories=data.categories.filter(c=>c.active&&((type==="INCOME"||type==="EXPENSE")?c.kind===(type==="INCOME"?"INCOME":"EXPENSE"):false));
 const visible=data.transactions.filter(t=>filter==="ALL"||t.type===filter).sort((a,b)=>b.date.localeCompare(a.date));

 function reset(){setEditing(null);setType("EXPENSE");setStatus("PAID");setDate(todayFinancialDate());setAmount("");setDescription("");setCategoryId("");setAccountId("");setDestinationAccountId("");setCreditCardId("");setPersonId("");setInstallments("2");setParcelado(false);setError("")}
 function edit(t:Transaction){
   if(t.installmentGroupId){setError("Parcelas vinculadas devem ser gerenciadas pelo grupo. Use os comandos de cancelamento abaixo.");return;}
   setEditing(t);setType(t.type);setStatus(t.status==="CANCELLED" ? (t.type==="INCOME" ? "RECEIVED" : "PAID") : t.status);setDate(t.date);setAmount((t.amountCents/100).toFixed(2).replace(".",","));setDescription(t.description);setCategoryId(t.categoryId??"");setAccountId(t.accountId??"");setDestinationAccountId(t.destinationAccountId??"");setCreditCardId(t.creditCardId??"");setPersonId(t.personId??"");setParcelado(false);setError("")
 }
 async function save(){
   setError("");
   try{
     const amountCents=parseAmount(amount);
     if(parcelado){
       if(type!=="EXPENSE") throw new Error("Parcelamento está disponível para saídas.");
       const count=Number(installments);
       if(!Number.isInteger(count)||count<2||count>120) throw new Error("Informe de 2 a 120 parcelas.");
       if(!accountId&&!creditCardId) throw new Error("Selecione uma conta ou um cartão.");
       if(accountId&&creditCardId) throw new Error("Uma compra parcelada deve usar conta ou cartão, não ambos.");
       if(creditCardId){
         const card=data.cards.find(c=>c.id===creditCardId);
         if(!card) throw new Error("Cartão inválido.");
         const available=calculateCardAvailableLimit(card,data.transactions);
         if(amountCents>available) throw new Error(`Limite disponível insuficiente para o total. Disponível: ${money(available)}.`);
       }
       const built=buildInstallmentSet({totalAmountCents:amountCents,installmentCount:count,firstDate:date,description,status,accountId:accountId||undefined,creditCardId:creditCardId||undefined,categoryId:categoryId||undefined,personId:personId||undefined});
       for(const tx of built.transactions) validateTransaction(tx,{accounts:data.accounts,cards:data.cards,transactions:[...data.transactions,...built.transactions]});
       setBusy(true);
       await onChange({...data,transactions:[...data.transactions,...built.transactions],installmentGroups:[...data.installmentGroups,built.group]});
       reset();
       return;
     }
     const tx:Transaction={id:editing?.id??crypto.randomUUID(),date,type,status,amountCents,description:description.trim(),...(categoryId?{categoryId}:{}),...(accountId?{accountId}:{}),...(destinationAccountId?{destinationAccountId}:{}),...(creditCardId?{creditCardId}:{}),...(personId?{personId}: {})};
     if(type==="EXPENSE"&&creditCardId){
       const card=data.cards.find(c=>c.id===creditCardId); if(!card) throw new Error("Cartão inválido.");
       const available=calculateCardAvailableLimit(card,data.transactions)+(editing?.creditCardId===card.id&&editing.type==="EXPENSE"?editing.amountCents:0);
       if(amountCents>available) throw new Error(`Limite disponível insuficiente. Disponível: ${money(available)}.`);
     }
     validateTransaction(tx,{accounts:data.accounts,cards:data.cards,transactions:data.transactions});
     const next={...data,transactions:editing?data.transactions.map(t=>t.id===tx.id?tx:t):[...data.transactions,tx]};
     setBusy(true);await onChange(next);reset();
   }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar.");}finally{setBusy(false)}
 }
 async function cancel(t:Transaction){
   if(!confirm("Cancelar este lançamento? O histórico será preservado."))return;
   setBusy(true);setError("");
   try{await onChange({...data,transactions:data.transactions.map(x=>x.id===t.id?{...x,status:"CANCELLED" as const}:x)});}catch(e){setError(e instanceof Error?e.message:"Não foi possível cancelar.");}finally{setBusy(false)}
 }
 async function cancelGroup(t:Transaction,mode:"ONE"|"THIS_AND_FOLLOWING"){
   const groupId=t.installmentGroupId;if(!groupId)return;
   const label=mode==="ONE"?"esta parcela":"esta e todas as seguintes";
   if(!confirm(`Cancelar ${label}? O histórico será preservado.`))return;
   setBusy(true);setError("");
   try{await onChange(cancelInstallments(data,groupId,t.id,mode));}catch(e){setError(e instanceof Error?e.message:"Não foi possível cancelar as parcelas.");}finally{setBusy(false)}
 }
 function labelType(t:Transaction){return t.type==="TRANSFER"?"Transferência":t.type==="CARD_PAYMENT"?"Pagamento de cartão":t.type==="INCOME"?"Entrada":t.creditCardId?"Compra no cartão":"Saída"}
 return <div className="page-content">
   <div className="page-heading"><div><span className="eyebrow">Movimentação</span><h1>Transações</h1></div><button className="primary compact" onClick={reset}>+ Novo lançamento</button></div>
   {error&&<div className="global-alert">{error}</div>}
   <div className="transaction-filters">{(["ALL","INCOME","EXPENSE","TRANSFER","CARD_PAYMENT"] as const).map(f=><button key={f} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f==="ALL"?"Todos":f==="INCOME"?"Entradas":f==="EXPENSE"?"Saídas":f==="TRANSFER"?"Transferências":"Cartão"}</button>)}</div>
   <section className="panel transaction-list">{visible.length===0?<Empty text="Nenhum lançamento encontrado."/>:visible.map(t=>{
     const group=t.installmentGroupId?data.installmentGroups.find(g=>g.id===t.installmentGroupId):undefined;
     const n=group?getInstallmentNumber(group,t.id):undefined;
     return <div className="transaction-row" key={t.id}><div><strong>{t.description||labelType(t)}</strong><span>{t.date} · {labelType(t)} · {t.status}{group&&` · Parcela ${n}/${group.installmentCount}`}</span></div>
       <div className="transaction-value"><strong>{t.type==="EXPENSE"||t.type==="CARD_PAYMENT"?"−":"+"}{money(t.amountCents)}</strong><div className="row-actions">
         {group ? <>{t.status!=="CANCELLED"&&<><button className="link-button danger" disabled={busy} onClick={()=>void cancelGroup(t,"ONE")}>Cancelar</button><button className="link-button danger" disabled={busy} onClick={()=>void cancelGroup(t,"THIS_AND_FOLLOWING")}>+ seguintes</button></>} </> :
           <>{<button className="link-button" onClick={()=>edit(t)}>Editar</button>}{t.status!=="CANCELLED"&&<button className="link-button danger" disabled={busy} onClick={()=>void cancel(t)}>Cancelar</button>}</>}
       </div></div></div>
   })}</section>
   <section className="panel form-panel"><h2>{editing?"Editar lançamento":"Novo lançamento"}</h2><div className="form-grid">
     <label>Tipo<select value={type} onChange={e=>{const v=e.target.value as TransactionType;setType(v);setCategoryId("");setCreditCardId("");if(v!=="EXPENSE")setParcelado(false)}}><option value="EXPENSE">Saída</option><option value="INCOME">Entrada</option><option value="TRANSFER">Transferência</option><option value="CARD_PAYMENT">Pagamento de cartão</option></select></label>
     <label>Status<select value={status} onChange={e=>setStatus(e.target.value as RecurringRule["status"])}>{type==="INCOME"?<><option value="RECEIVED">Recebido</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>:<><option value="PAID">Pago</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>}{status==="CANCELLED"&&<option value="CANCELLED">Cancelado</option>}</select></label>
     <label>Data<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>
     <label>Valor total<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0,00" required/></label>
     <label>Descrição<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Ex.: Mercado"/></label>
     {(type==="INCOME"||type==="EXPENSE")&&<label>Categoria<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Selecione</option>{activeCategories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
     <label>{type==="TRANSFER"?"Conta de origem":"Conta"}<select value={accountId} onChange={e=>{setAccountId(e.target.value);if(e.target.value)setCreditCardId("")}}><option value="">Selecione</option>{activeAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
     {type==="TRANSFER"&&<label>Conta de destino<select value={destinationAccountId} onChange={e=>setDestinationAccountId(e.target.value)}><option value="">Selecione</option>{activeAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
     {type==="EXPENSE"&&<label>Cartão de crédito (opcional)<select value={creditCardId} onChange={e=>{setCreditCardId(e.target.value);if(e.target.value)setAccountId("")}}><option value="">Nenhum / conta</option>{activeCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
     {type==="CARD_PAYMENT"&&<label>Cartão<select value={creditCardId} onChange={e=>setCreditCardId(e.target.value)}><option value="">Selecione</option>{activeCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
     {type!=="TRANSFER"&&<label>Pessoa (opcional)<select value={personId} onChange={e=>setPersonId(e.target.value)}><option value="">Nenhuma</option>{activePeople.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
     {type==="EXPENSE"&&<label className="checkbox-field"><input type="checkbox" checked={parcelado} onChange={e=>setParcelado(e.target.checked)} disabled={!!editing}/> Parcelar esta saída</label>}
     {parcelado&&<label>Número de parcelas<input type="number" min="2" max="120" value={installments} onChange={e=>setInstallments(e.target.value)}/></label>}
   </div>
   {parcelado&&<p className="form-note">O valor informado é o total da compra. As parcelas são geradas mensalmente, com o eventual centavo restante distribuído nas primeiras parcelas. Em compras no cartão, cada parcela entra na fatura correspondente à sua data.</p>}
   <div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar alterações":"Registrar lançamento"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar edição</button>}</div>
   {!parcelado&&<p className="form-note">Compra no cartão não reduz a conta. O pagamento da fatura movimenta a conta e não cria outra despesa.</p>}
   </section>
 </div>;
}

function Recurring({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
 const [editing,setEditing]=useState<RecurringRule|null>(null);
 const [description,setDescription]=useState("");
 const [frequency,setFrequency]=useState<RecurringFrequency>("MONTHLY");
 const [startDate,setStartDate]=useState(()=>todayFinancialDate());
 const [endDate,setEndDate]=useState("");
 const [amount,setAmount]=useState("");
 const [type,setType]=useState<"INCOME"|"EXPENSE">("EXPENSE");
 const [status,setStatus]=useState<RecurringRule["status"]>("PLANNED");
 const [accountId,setAccountId]=useState("");
 const [creditCardId,setCreditCardId]=useState("");
 const [categoryId,setCategoryId]=useState("");
 const [personId,setPersonId]=useState("");
 const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 const activeAccounts=data.accounts.filter(a=>a.active),activeCards=data.cards.filter(c=>c.active),activePeople=data.people.filter(p=>p.active);
 const activeCategories=data.categories.filter(c=>c.active&&c.kind===type);
 function reset(){setEditing(null);setDescription("");setFrequency("MONTHLY");setStartDate(todayFinancialDate());setEndDate("");setAmount("");setType("EXPENSE");setStatus("PLANNED");setAccountId("");setCreditCardId("");setCategoryId("");setPersonId("");setError("")}
 function edit(rule:RecurringRule){
   setEditing(rule);setDescription(rule.description);setFrequency(rule.frequency);setStartDate(rule.startDate);setEndDate(rule.endDate??"");setAmount((rule.amountCents/100).toFixed(2).replace(".",","));setType(rule.type);setStatus(rule.status==="CANCELLED" ? (rule.type==="INCOME" ? "RECEIVED" : "PAID") : rule.status);setAccountId(rule.accountId??"");setCreditCardId(rule.creditCardId??"");setCategoryId(rule.categoryId??"");setPersonId(rule.personId??"");setError("");
 }
 async function save(){
   setError("");
   try{
     const cents=parseAmount(amount);
     if(type==="EXPENSE"&&!accountId&&!creditCardId) throw new Error("Despesa recorrente precisa de conta ou cartão.");
     if(accountId&&creditCardId) throw new Error("Use conta ou cartão, não ambos.");
     if(editing){
       if(editing.transactionIds.length>0) throw new Error("Esta recorrência já possui lançamentos gerados. Para preservar o histórico, a alteração da série será feita em uma etapa própria.");
       const replacement=createRecurringRule({description,frequency,startDate,endDate:endDate||undefined,amountCents:cents,type,status,accountId:accountId||undefined,creditCardId:creditCardId||undefined,categoryId:categoryId||undefined,personId:personId||undefined,active:editing.active});
       const next={...data,recurringRules:data.recurringRules.map(r=>r.id===editing.id?replacement:r)};
       setBusy(true);await onChange(next);reset();return;
     }
     const created=createRecurringRule({description,frequency,startDate,endDate:endDate||undefined,amountCents:cents,type,status,accountId:accountId||undefined,creditCardId:creditCardId||undefined,categoryId:categoryId||undefined,personId:personId||undefined,active:true});
     const horizon=new Date(); horizon.setMonth(horizon.getMonth()+12);
     const horizonDate=`${horizon.getFullYear()}-${String(horizon.getMonth()+1).padStart(2,"0")}-${String(horizon.getDate()).padStart(2,"0")}`;
     const generated=generateRecurringTransactions({...data,recurringRules:[...data.recurringRules,created]},created,horizonDate);
     setBusy(true);await onChange(generated.data);reset();
   }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar a recorrência.");}finally{setBusy(false)}
 }
 async function generate(rule:RecurringRule){
   setBusy(true);setError("");
   try{const horizon=new Date();horizon.setMonth(horizon.getMonth()+12);const through=`${horizon.getFullYear()}-${String(horizon.getMonth()+1).padStart(2,"0")}-${String(horizon.getDate()).padStart(2,"0")}`;const result=generateRecurringTransactions(data,rule,through);await onChange(result.data)}catch(e){setError(e instanceof Error?e.message:"Não foi possível gerar os lançamentos.");}finally{setBusy(false)}
 }
 async function deactivate(rule:RecurringRule){
   if(!confirm("Desativar esta recorrência? Os lançamentos já gerados serão preservados."))return;
   setBusy(true);setError("");
   try{await onChange(deactivateRecurringRule(data,rule.id))}catch(e){setError(e instanceof Error?e.message:"Não foi possível desativar.")}finally{setBusy(false)}
 }
 const frequencyLabel=(f:RecurringFrequency)=>({WEEKLY:"Semanal",BIWEEKLY:"Quinzenal",MONTHLY:"Mensal",BIMONTHLY:"Bimestral",QUARTERLY:"Trimestral",SEMIANNUAL:"Semestral",ANNUAL:"Anual"}[f]);
 return <div className="page-content">
   <div className="page-heading"><div><span className="eyebrow">Automação</span><h1>Recorrências</h1></div><button className="primary compact" onClick={reset}>+ Nova recorrência</button></div>
   {error&&<div className="global-alert">{error}</div>}
   <section className="panel transaction-list">{data.recurringRules.filter(r=>r.active).length===0?<Empty text="Nenhuma recorrência ativa."/>:data.recurringRules.filter(r=>r.active).map(r=><div className="transaction-row" key={r.id}><div><strong>{r.description}</strong><span>{frequencyLabel(r.frequency)} · desde {r.startDate} · {money(r.amountCents)} · {r.transactionIds.length} lançamentos gerados</span></div><div className="row-actions"><button className="link-button" onClick={()=>edit(r)}>Editar regra</button><button className="link-button" disabled={busy} onClick={()=>void generate(r)}>Gerar próximos</button><button className="link-button danger" disabled={busy} onClick={()=>void deactivate(r)}>Desativar</button></div></div>)}</section>
   <section className="panel form-panel"><h2>{editing?"Editar recorrência":"Nova recorrência"}</h2><div className="form-grid">
    <label>Tipo<select value={type} onChange={e=>{const v=e.target.value as "INCOME"|"EXPENSE";setType(v);setCategoryId("");if(v==="INCOME")setCreditCardId("")}}><option value="EXPENSE">Saída</option><option value="INCOME">Entrada</option></select></label>
    <label>Frequência<select value={frequency} onChange={e=>setFrequency(e.target.value as RecurringFrequency)}><option value="WEEKLY">Semanal</option><option value="BIWEEKLY">Quinzenal</option><option value="MONTHLY">Mensal</option><option value="BIMONTHLY">Bimestral</option><option value="QUARTERLY">Trimestral</option><option value="SEMIANNUAL">Semestral</option><option value="ANNUAL">Anual</option></select></label>
    <label>Data inicial<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
    <label>Data final (opcional)<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
    <label>Valor<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0,00"/></label>
    <label>Status<select value={status} onChange={e=>setStatus(e.target.value as TransactionStatus)}>{type==="INCOME"?<><option value="RECEIVED">Recebido</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>:<><option value="PAID">Pago</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>}</select></label>
    <label>Descrição<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Ex.: Aluguel"/></label>
    {activeCategories.length>0&&<label>Categoria<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Nenhuma</option>{activeCategories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    <label>Conta<select value={accountId} onChange={e=>{setAccountId(e.target.value);if(e.target.value)setCreditCardId("")}}><option value="">Nenhuma</option>{activeAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    {type==="EXPENSE"&&<label>Cartão<select value={creditCardId} onChange={e=>{setCreditCardId(e.target.value);if(e.target.value)setAccountId("")}}><option value="">Nenhum</option>{activeCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    <label>Pessoa (opcional)<select value={personId} onChange={e=>setPersonId(e.target.value)}><option value="">Nenhuma</option>{activePeople.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   </div><p className="form-note">Ao criar uma recorrência, o sistema gera os próximos 12 meses de lançamentos. Novos lançamentos não são duplicados ao usar “Gerar próximos”.</p>
   <div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar regra":"Criar recorrência"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar</button>}</div></section>
 </div>;
}

function Pots({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
 const [name,setName]=useState(""); const [target,setTarget]=useState(""); const [amount,setAmount]=useState(""); const [movementType,setMovementType]=useState<"DEPOSIT"|"WITHDRAWAL">("DEPOSIT");
 const [description,setDescription]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 const real=useMemo(()=>calculateTotalRealBalance({accounts:data.accounts,cards:data.cards,transactions:data.transactions}),[data]);
 const reserved=getTotalReserved(data), free=getFreeCash(real,data);
 const active=data.pots.filter(p=>p.active);
 function reset(){setName("");setTarget("");setAmount("");setMovementType("DEPOSIT");setDescription("");setError("")}
 async function savePot(){
   setError("");try{const targetCents=parseAmount(target);const pot=createPot(name,targetCents);setBusy(true);await onChange({...data,pots:[...data.pots,pot]});reset()}catch(e){setError(e instanceof Error?e.message:"Não foi possível criar a caixinha.")}finally{setBusy(false)}
 }
 async function movement(potId:string){
   setError("");try{const cents=parseAmount(amount);const next=createPotMovement(data,{potId,type:movementType,amountCents:cents,date:todayFinancialDate(),description:description|| (movementType==="DEPOSIT"?"Reserva":"Resgate")},real);setBusy(true);await onChange(next);setAmount("");setDescription("")}catch(e){setError(e instanceof Error?e.message:"Não foi possível registrar o movimento.")}finally{setBusy(false)}
 }
 async function archive(pot:Pot){if(!confirm("Arquivar esta caixinha? O histórico dos movimentos será preservado."))return;setBusy(true);setError("");try{await onChange(archivePot(data,pot.id))}catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar.")}finally{setBusy(false)}}
 return <div className="page-content">
   <div className="page-heading"><div><span className="eyebrow">Reservas</span><h1>Caixinhas</h1></div><button className="primary compact" onClick={reset}>+ Nova caixinha</button></div>
   {error&&<div className="global-alert">{error}</div>}
   <section className="panel"><strong>{mode==="REALIZED"?"Realizado":"Projetado"}</strong><p className="form-note">{mode==="REALIZED"?"Considera somente receitas recebidas e despesas/pagamentos efetivados.":"Inclui lançamentos não cancelados, inclusive pendentes e planejados."}</p></section>\n  <section className="metric-grid"><article className="metric"><span>Dinheiro livre</span><strong>{money(free)}</strong><small>Saldo real menos reservas ativas.</small></article><article className="metric"><span>Total reservado</span><strong>{money(reserved)}</strong><small>Valor separado nas caixinhas.</small></article></section>
   <section className="panel pot-list">{active.length===0?<Empty text="Nenhuma caixinha criada."/>:active.map(p=>{const balance=getPotBalance(p.id,data);const percent=p.targetCents>0?Math.min(100,balance/p.targetCents*100):0;return <article className="pot-card" key={p.id}><div className="pot-head"><div><strong>{p.name}</strong><span>Meta {money(p.targetCents)}</span></div><strong>{money(balance)}</strong></div><div className="pot-progress"><div style={{width:`${percent}%`}}/></div><small>{percent.toFixed(0)}% da meta</small><div className="pot-movement-form"><select value={movementType} onChange={e=>setMovementType(e.target.value as "DEPOSIT"|"WITHDRAWAL")}><option value="DEPOSIT">Depositar</option><option value="WITHDRAWAL">Resgatar</option></select><input inputMode="decimal" placeholder="0,00" value={amount} onChange={e=>setAmount(e.target.value)}/><input placeholder="Descrição" value={description} onChange={e=>setDescription(e.target.value)}/><button className="primary compact" disabled={busy} onClick={()=>void movement(p.id)}>Registrar</button></div><div className="row-actions"><button className="link-button danger" disabled={busy} onClick={()=>void archive(p)}>Arquivar</button></div></article>})}</section>
   <section className="panel form-panel"><h2>Nova caixinha</h2><div className="form-grid"><label>Nome<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Imposto da obra"/></label><label>Meta<input inputMode="decimal" value={target} onChange={e=>setTarget(e.target.value)} placeholder="2.000,00"/></label></div><div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void savePot()}>{busy?"Salvando…":"Criar caixinha"}</button></div><p className="form-note">Caixinhas são reservas lógicas: não retiram dinheiro novamente da conta. O saldo real continua sendo o das contas; o dinheiro livre é calculado descontando as reservas.</p></section>
 </div>;
}

function Budgets({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
 const [editing,setEditing]=useState<Budget|null>(null);
 const [month,setMonth]=useState(()=>todayFinancialDate().slice(0,7));
 const [categoryId,setCategoryId]=useState(""); const [limit,setLimit]=useState("");
 const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 const categories=data.categories.filter(c=>c.active&&c.kind==="EXPENSE");
 const budgets=data.budgets.filter(b=>b.active);
 function reset(){setEditing(null);setMonth(todayFinancialDate().slice(0,7));setCategoryId("");setLimit("");setError("")}
 function edit(b:Budget){setEditing(b);setMonth(b.month);setCategoryId(b.categoryId);setLimit((b.limitCents/100).toFixed(2).replace(".",","));setError("")}
 async function save(){
   setError("");try{
     const cents=parseAmount(limit); if(!categoryId)throw new Error("Selecione uma categoria.");
     const duplicate=data.budgets.find(b=>b.active&&b.month===month&&b.categoryId===categoryId&&b.id!==editing?.id);
     if(duplicate)throw new Error("Já existe um orçamento ativo para esta categoria neste mês.");
     const budget=editing?{...editing,month,categoryId,limitCents:cents,active:true}:createBudget(month,categoryId,cents,data);
     const next={...data,budgets:editing?data.budgets.map(b=>b.id===budget.id?budget:b):[...data.budgets,budget]};
     setBusy(true);await onChange(next);reset();
   }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar o orçamento.")}finally{setBusy(false)}
 }
 async function archive(b:Budget){if(!confirm("Arquivar este orçamento? O histórico dos lançamentos será preservado."))return;setBusy(true);setError("");try{await onChange({...data,budgets:data.budgets.map(x=>x.id===b.id?{...x,active:false}:x)})}catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar.")}finally{setBusy(false)}}
 return <div className="page-content">
  <div className="page-heading"><div><span className="eyebrow">Planejamento</span><h1>Orçamentos</h1></div><button className="primary compact" onClick={reset}>+ Novo orçamento</button></div>
  {error&&<div className="global-alert">{error}</div>}
  <section className="panel budget-list">{budgets.length===0?<Empty text="Nenhum orçamento cadastrado."/>:budgets.sort((a,b)=>b.month.localeCompare(a.month)).map(b=>{const cat=data.categories.find(c=>c.id===b.categoryId);const spent=getBudgetSpent(data,b);const pct=getBudgetStatus(spent,b.limitCents);const percent=b.limitCents===0?(spent>0?100:0):Math.min(100,spent/b.limitCents*100);return <article className="budget-card" key={b.id}><div className="budget-head"><div><strong>{cat?.name??"Categoria removida"}</strong><span>{b.month}</span></div><strong>{money(spent)} / {money(b.limitCents)}</strong></div><div className="budget-progress"><div className={pct.toLowerCase()} style={{width:`${percent}%`}}/></div><div className="budget-meta"><span>{pct==="NORMAL"?"Dentro do orçamento":pct==="ATTENTION"?"Atenção: 80% ou mais":"Orçamento excedido"}</span><span>{b.limitCents>0?Math.round(spent/b.limitCents*100):spent>0?"∞":0}%</span></div><div className="row-actions"><button className="link-button" onClick={()=>edit(b)}>Editar</button><button className="link-button danger" disabled={busy} onClick={()=>void archive(b)}>Arquivar</button></div></article>})}</section>
  <section className="panel form-panel"><h2>{editing?"Editar orçamento":"Novo orçamento"}</h2><div className="form-grid"><label>Mês<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><label>Categoria<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Selecione</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Limite mensal<input inputMode="decimal" value={limit} onChange={e=>setLimit(e.target.value)} placeholder="0,00"/></label></div><div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar alterações":"Criar orçamento"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar</button>}</div><p className="form-note">O gasto é apurado pela data da compra. Compras no cartão entram no mês da compra, e lançamentos cancelados não entram no realizado.</p></section>
 </div>;
}

function Reports({data}:{data:EntityCollection}) {
 const [month,setMonth]=useState(()=>todayFinancialDate().slice(0,7));
 const [mode,setMode]=useState<"REALIZED"|"PROJECTED">("REALIZED");
 const cats=expensesByCategory(data,month,mode), income=incomeByCategory(data,month,mode), people=expensesByPerson(data,month,mode), flow=cashFlow(data,month,mode), months=monthlyExpenses(data,mode).slice(-6);
 return <div className="page-content">
  <div className="page-heading"><div><span className="eyebrow">Análise</span><h1>Relatórios</h1></div><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div>
  <section className="metric-grid"><article className="metric"><span>Receitas</span><strong>{money(flow.incomeCents)}</strong></article><article className="metric"><span>Despesas</span><strong>{money(flow.expenseCents)}</strong></article><article className="metric"><span>Pagamentos de cartão</span><strong>{money(flow.cardPaymentsCents)}</strong><small>Saída de caixa, sem duplicar despesa</small></article><article className="metric"><span>Resultado de caixa</span><strong>{money(flow.netCents)}</strong></article></section>
  <section className="panel report-section"><h2>Despesas por categoria</h2>{cats.length===0?<Empty text="Nenhuma despesa categorizada neste mês."/>:<div className="report-list">{cats.map(x=><div className="report-row" key={x.categoryId}><span>{x.name}</span><strong>{money(x.amountCents)}</strong></div>)}</div>}</section>
  <section className="panel report-section"><h2>Receitas por categoria</h2>{income.length===0?<Empty text="Nenhuma receita categorizada neste mês."/>:<div className="report-list">{income.map(x=><div className="report-row" key={x.categoryId}><span>{x.name}</span><strong>{money(x.amountCents)}</strong></div>)}</div>}</section>
  <section className="panel report-section"><h2>Despesas por pessoa</h2>{people.length===0?<Empty text="Nenhuma despesa vinculada a pessoa neste mês."/>:<div className="report-list">{people.map(x=><div className="report-row" key={x.personId}><span>{x.name}</span><strong>{money(x.amountCents)}</strong></div>)}</div>}</section>
  <section className="panel report-section"><h2>Evolução mensal de despesas</h2>{months.length===0?<Empty text="Ainda não há histórico de despesas."/>:<div className="report-list">{months.map(x=><div className="report-row" key={x.month}><span>{x.month}</span><strong>{money(x.amountCents)}</strong></div>)}</div>}</section>
 </div>;
}

function Settings({data,onChange,onSignOut}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>;onSignOut:()=>Promise<void>}) {
 const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
 async function importFile(file:File){
  setError("");setBusy(true);
  try{
   const next=importJson(await file.text());
   if(!confirm("Importar este backup substituirá os dados locais atuais. Deseja continuar?"))return;
   await onChange(next); alert("Backup importado com sucesso.");
  }catch(e){setError(e instanceof Error?e.message:"Backup inválido.");}
  finally{setBusy(false);}
 }
 return <div className="page-content"><div className="page-heading"><div><span className="eyebrow">Aplicativo</span><h1>Configurações</h1></div></div>
 {error&&<div className="global-alert">{error}</div>}
 <section className="panel settings-list">
  <div><strong>Backup completo</strong><p>Exporta todas as entidades financeiras em JSON.</p><button className="primary compact" onClick={()=>exportJson(data)}>Exportar JSON</button></div>
  <div><strong>Exportar lançamentos</strong><p>Gera CSV para Excel ou LibreOffice.</p><button className="secondary compact" onClick={()=>exportTransactionsCsv(data)}>Exportar CSV</button></div>
  <div><strong>Importar backup</strong><p>O arquivo é validado antes de substituir os dados locais.</p><input type="file" accept="application/json,.json" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.currentTarget.value=""}}/></div>
  <div><strong>Sessão</strong><p>Encerrar a sessão neste aparelho.</p><button className="secondary compact" onClick={()=>void onSignOut()}>Sair da conta</button></div>
 </section>
 <section className="panel"><h2>Integridade</h2><p className="form-note">O backup mantém versão de esquema e valida relações entre entidades antes da importação.</p></section>
 </div>;
}

function Assistant({data}:{data:EntityCollection}) {
 const [month,setMonth]=useState(todayFinancialDate().slice(0,7));
 const result=useMemo(()=>analyzeFinances(data,month),[data,month]);
 return <div className="page-content"><div className="page-heading"><div><span className="eyebrow">Análise</span><h1>Assistente financeiro</h1></div><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div>
 <section className="panel"><p className="form-note">As análises abaixo são calculadas localmente a partir dos seus dados. Nenhuma alteração financeira é feita pelo assistente.</p></section>
 <div className="insight-list">{result.insights.map((x,i)=><article className={`panel insight ${x.kind}`} key={i}><strong>{x.title}</strong><p>{x.detail}</p></article>)}</div>
 </div>;
}

function SmartInput({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
 const [text,setText]=useState("");
 const [draft,setDraft]=useState<SmartDraft|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [listening,setListening]=useState(false);
 const recognitionRef=useRef<any>(null);
 function startVoice(){
   setError("");
   const SpeechRecognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
   if(!SpeechRecognition){setError("Seu navegador não oferece reconhecimento de voz nesta versão. Você pode digitar normalmente.");return;}
   const recognition=new SpeechRecognition();
   recognition.lang="pt-BR"; recognition.interimResults=true; recognition.continuous=false;
   recognition.onstart=()=>setListening(true);
   recognition.onresult=(event:any)=>{let value="";for(let i=event.resultIndex;i<event.results.length;i++)value+=event.results[i][0].transcript;setText(value)};
   recognition.onerror=()=>{setListening(false);setError("Não foi possível reconhecer a fala. Tente novamente ou digite o lançamento.");};
   recognition.onend=()=>{setListening(false);recognitionRef.current=null};
   recognitionRef.current=recognition;recognition.start();
 }
 function stopVoice(){recognitionRef.current?.stop();setListening(false)}
 function interpret(){
   setError("");
   try{ setDraft(parseSmartInput(text,{categories:data.categories,accounts:data.accounts,cards:data.cards})); }
   catch(e){setDraft(null);setError(e instanceof Error?e.message:"Não foi possível interpretar.");}
 }
 function update<K extends keyof SmartDraft>(key:K,value:SmartDraft[K]){setDraft(d=>d?{...d,[key]:value}:d)}
 async function confirm(){
   if(!draft)return;
   setError("");
   try{
     const amountCents=parseSmartAmount(String(draft.amountCents/100).replace(".",",")) ?? 0;
     const tx:Transaction={
       id:crypto.randomUUID(),date:draft.date,type:draft.type,status:draft.type==="INCOME"?"RECEIVED":"PAID",
       amountCents,description:draft.description.trim(),
       ...(draft.categoryId?{categoryId:draft.categoryId}:{}),
       ...(draft.accountId?{accountId:draft.accountId}:{}),
       ...(draft.destinationAccountId?{destinationAccountId:draft.destinationAccountId}:{}),
       ...(draft.creditCardId?{creditCardId:draft.creditCardId}:{})
     };
     validateTransaction(tx,{accounts:data.accounts,cards:data.cards,transactions:data.transactions});
     setBusy(true);
     await onChange({...data,transactions:[...data.transactions,tx]});
     setText("");setDraft(null);
   }catch(e){setError(e instanceof Error?e.message:"Não foi possível confirmar.");}
   finally{setBusy(false)}
 }
 const categories=data.categories.filter(c=>c.active&&c.kind===(draft?.type==="INCOME"?"INCOME":"EXPENSE"));
 const canConfirm=!!draft && (draft.type==="INCOME" ? !!draft.accountId && !!draft.categoryId : draft.type==="EXPENSE" ? !!draft.categoryId && (!!draft.accountId !== !!draft.creditCardId) : draft.type==="TRANSFER" ? !!draft.accountId && !!draft.destinationAccountId && draft.accountId!==draft.destinationAccountId : draft.type==="CARD_PAYMENT" ? !!draft.accountId && !!draft.creditCardId : false);
 return <div className="page-content">
   <div className="page-heading"><div><span className="eyebrow">Entrada rápida</span><h1>Entrada inteligente</h1></div></div>
   <section className="panel form-panel">
     <p className="muted">Digite como você falaria normalmente. Nada é salvo até você revisar e confirmar.</p>
     <label>O que aconteceu?<textarea value={text} onChange={e=>setText(e.target.value)} rows={4} placeholder='Ex.: "Paguei 150 no mercado ontem"'/></label>
     <div className="voice-actions"><button className={listening?"secondary":"primary"} type="button" onClick={listening?stopVoice:startVoice}>{listening?"Parar gravação":"Falar lançamento"}</button><span className="form-note">{listening?"Ouvindo em português… fale naturalmente.": "A fala vira texto e passa pela mesma revisão da entrada digitada."}</span></div>
     {error&&<div className="global-alert">{error}</div>}
     <div className="form-actions"><button className="primary" disabled={!text.trim()||busy} onClick={interpret}>Interpretar</button>{draft&&<button className="secondary" onClick={()=>{setDraft(null);setError("")}}>Descartar</button>}</div>
   </section>
   {draft&&<section className="panel form-panel">
     <div className="smart-review-head"><div><span className="eyebrow">Revisão</span><h2>Confira antes de salvar</h2></div><span className={`smart-confidence ${draft.confidence.toLowerCase()}`}>{draft.confidence}</span></div>
     {draft.warnings.length>0&&<div className="alert error"><strong>Atenção:</strong><ul>{draft.warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
     <div className="form-grid">
       <label>Tipo<select value={draft.type} onChange={e=>update("type",e.target.value as TransactionType)}><option value="EXPENSE">Saída</option><option value="INCOME">Entrada</option><option value="TRANSFER">Transferência</option><option value="CARD_PAYMENT">Pagamento de cartão</option></select></label>
       <label>Valor<input inputMode="decimal" value={(draft.amountCents/100).toFixed(2).replace(".",",")} onChange={e=>{const c=parseSmartAmount(e.target.value);if(c!==null)update("amountCents",c)}}/></label>
       <label>Data<input type="date" value={draft.date} onChange={e=>update("date",e.target.value)}/></label>
       <label>Descrição<input value={draft.description} onChange={e=>update("description",e.target.value)}/></label>
       {(draft.type==="INCOME"||draft.type==="EXPENSE")&&<label>Categoria<select value={draft.categoryId??""} onChange={e=>update("categoryId",e.target.value||undefined)}><option value="">Selecione</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
       <label>Conta de origem/recebimento<select value={draft.accountId??""} onChange={e=>{update("accountId",e.target.value||undefined);if(draft.type==="EXPENSE"&&e.target.value)update("creditCardId",undefined)}}><option value="">Selecione</option>{data.accounts.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
       {draft.type==="TRANSFER"&&<label>Conta de destino<select value={draft.destinationAccountId??""} onChange={e=>update("destinationAccountId",e.target.value||undefined)}><option value="">Selecione</option>{data.accounts.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
       {(draft.type==="EXPENSE"||draft.type==="CARD_PAYMENT")&&<label>Cartão{draft.type==="EXPENSE"?" (opcional)":""}<select value={draft.creditCardId??""} onChange={e=>{update("creditCardId",e.target.value||undefined);if(e.target.value&&draft.type==="EXPENSE")update("accountId",undefined)}}><option value="">Selecione</option>{data.cards.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
     </div>
     <div className="form-actions"><button className="primary" disabled={busy||!canConfirm} onClick={()=>void confirm()}>{busy?"Salvando…":"Confirmar lançamento"}</button></div>
     <p className="form-note">O parser apenas propõe um lançamento. A confirmação passa pelo mesmo motor de validação dos lançamentos manuais.</p>
   </section>}
 </div>;
}

function ReceiptScanner({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
 const [text,setText]=useState("");
 const [draft,setDraft]=useState<SmartDraft|null>(null);
 const [confidence,setConfidence]=useState<number|null>(null);
 const [progress,setProgress]=useState(0);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const categories=data.categories.filter(c=>c.active&&c.kind==="EXPENSE");
 async function scan(file:File){
   setBusy(true);setError("");setDraft(null);setText("");setConfidence(null);setProgress(0);
   try{
     const result=await recognizeReceipt(file,setProgress);
     setText(result.text);setConfidence(result.confidence);
     const total=extractReceiptTotal(result.text), date=extractReceiptDate(result.text), merchant=extractReceiptMerchant(result.text);
     if(total===null)throw new Error("Não identifiquei o valor total com segurança. Revise o texto ou use Entrada inteligente.");
     const d:SmartDraft={type:"EXPENSE",amountCents:total,date:date??todayFinancialDate(),description:merchant||"Compra no recibo",confidence:result.confidence>=80?"HIGH":result.confidence>=55?"MEDIUM":"LOW",warnings:[],needsReview:true};
     if(!date)d.warnings.push("Data não identificada; confira a data.");
     if(!merchant)d.warnings.push("Estabelecimento não identificado; confira a descrição.");
     d.warnings.push("OCR pode conter erros. Revise todos os campos antes de confirmar.");
     setDraft(d);
   }catch(e){setError(e instanceof Error?e.message:"Não foi possível ler o recibo.");}
   finally{setBusy(false)}
 }
 function update<K extends keyof SmartDraft>(key:K,value:SmartDraft[K]){setDraft(d=>d?{...d,[key]:value}:d)}
 async function confirm(){
   if(!draft)return;
   const validCategory=!!draft.categoryId, source=!!draft.accountId!==!!draft.creditCardId;
   if(!validCategory||!source){setError("Selecione uma categoria e exatamente uma conta ou cartão.");return}
   try{
     const tx:Transaction={id:crypto.randomUUID(),date:draft.date,type:"EXPENSE",status:"PAID",amountCents:draft.amountCents,description:draft.description.trim(),categoryId:draft.categoryId, ...(draft.accountId?{accountId:draft.accountId}:{}),...(draft.creditCardId?{creditCardId:draft.creditCardId}:{})};
     validateTransaction(tx,{accounts:data.accounts,cards:data.cards,transactions:data.transactions});
     setBusy(true);await onChange({...data,transactions:[...data.transactions,tx]});setDraft(null);setText("");
   }catch(e){setError(e instanceof Error?e.message:"Não foi possível confirmar.");}finally{setBusy(false)}
 }
 return <div className="page-content">
  <div className="page-heading"><div><span className="eyebrow">OCR local</span><h1>Ler recibo</h1></div></div>
  <section className="panel form-panel">
   <p className="muted">Fotografe o recibo. A leitura é feita no dispositivo e o resultado fica apenas como rascunho até sua confirmação.</p>
   <label className="file-capture">Tirar foto ou escolher recibo<input type="file" accept="image/*" capture="environment" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void scan(file)}}/></label>
   {busy&&<p className="form-note">Lendo recibo… {Math.round(progress*100)}%</p>}
   {confidence!==null&&<p className="form-note">Confiança média do OCR: {Math.round(confidence)}%. Isso não significa que os campos financeiros estejam corretos.</p>}
   {error&&<div className="global-alert">{error}</div>}
  </section>
  {draft&&<section className="panel form-panel">
   <div className="smart-review-head"><div><span className="eyebrow">Revisão obrigatória</span><h2>Confira o recibo</h2></div><span className="smart-confidence medium">OCR</span></div>
   <div className="form-grid">
    <label>Valor<input inputMode="decimal" value={(draft.amountCents/100).toFixed(2).replace(".",",")} onChange={e=>{const c=parseSmartAmount(e.target.value);if(c!==null)update("amountCents",c)}}/></label>
    <label>Data<input type="date" value={draft.date} onChange={e=>update("date",e.target.value)}/></label>
    <label>Estabelecimento<input value={draft.description} onChange={e=>update("description",e.target.value)}/></label>
    <label>Categoria<select value={draft.categoryId??""} onChange={e=>update("categoryId",e.target.value||undefined)}><option value="">Selecione</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Conta<select value={draft.accountId??""} onChange={e=>{update("accountId",e.target.value||undefined);if(e.target.value)update("creditCardId",undefined)}}><option value="">Nenhuma</option>{data.accounts.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label>Cartão<select value={draft.creditCardId??""} onChange={e=>{update("creditCardId",e.target.value||undefined);if(e.target.value)update("accountId",undefined)}}><option value="">Nenhum</option>{data.cards.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   </div>
   {draft.warnings.length>0&&<div className="alert error"><ul>{draft.warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
   <details><summary>Texto bruto do OCR</summary><pre className="ocr-text">{text||"Nenhum texto."}</pre></details>
   <div className="form-actions"><button className="primary" disabled={busy||!draft.categoryId||(!draft.accountId&&!draft.creditCardId)} onClick={()=>void confirm()}>Confirmar lançamento</button><button className="secondary" onClick={()=>setDraft(null)}>Descartar</button></div>
  </section>}
 </div>;
}

function Categories({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
 const [editing,setEditing]=useState<Category|null>(null); const [name,setName]=useState(""); const [kind,setKind]=useState<Category["kind"]>("EXPENSE"); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 function reset(){setEditing(null);setName("");setKind("EXPENSE");setError("")}
 function edit(c:Category){setEditing(c);setName(c.name);setKind(c.kind);setError("")}
 async function save(){setError("");try{const c=editing?updateCategory(editing,name,kind,data):createCategory(name,kind,data);setBusy(true);await onChange({...data,categories:editing?data.categories.map(x=>x.id===c.id?c:x):[...data.categories,c]});reset();}catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar a categoria.");}finally{setBusy(false)}}
 async function archive(c:Category){if(!confirm("Arquivar esta categoria? O histórico dos lançamentos será preservado."))return;setBusy(true);setError("");try{await onChange({...data,categories:data.categories.map(x=>x.id===c.id?archiveCategory(x):x)});}catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar a categoria.");}finally{setBusy(false)}}
 const active=data.categories.filter(c=>c.active);
 return <div className="page-content">
  <div className="page-heading"><div><span className="eyebrow">Cadastros</span><h1>Categorias</h1></div><button className="primary compact" onClick={reset}>+ Nova categoria</button></div>
  {error&&<div className="global-alert">{error}</div>}
  <section className="panel">{active.length===0?<Empty text="Nenhuma categoria cadastrada."/>:<div className="report-list">{active.map(c=><div className="report-row" key={c.id}><span><strong>{c.name}</strong> · {c.kind==="EXPENSE"?"Despesa":"Receita"}</span><div className="row-actions"><button className="link-button" onClick={()=>edit(c)}>Editar</button><button className="link-button danger" disabled={busy} onClick={()=>void archive(c)}>Arquivar</button></div></div>)}</div>}</section>
  <section className="panel form-panel"><h2>{editing?"Editar categoria":"Nova categoria"}</h2><div className="form-grid"><label>Nome<input value={name} maxLength={60} onChange={e=>setName(e.target.value)} placeholder="Ex.: Alimentação"/></label><label>Tipo<select value={kind} onChange={e=>setKind(e.target.value as Category["kind"])}><option value="EXPENSE">Despesa</option><option value="INCOME">Receita</option></select></label></div><div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar alterações":"Adicionar categoria"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar</button>}</div><p className="form-note">Arquivar remove a categoria dos novos lançamentos, mas preserva os lançamentos históricos e seus relatórios.</p></section>
 </div>;
}

function People({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
 const [editing,setEditing]=useState<Person|null>(null);
 const [name,setName]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");

 function reset(){setEditing(null);setName("");setError("")}
 function edit(person:Person){setEditing(person);setName(person.name);setError("")}

 async function save(){
   setError("");
   try{
     const person=editing?updatePerson(editing,name,data):createPerson(name,data);
     setBusy(true);
     await onChange({...data,people:editing?data.people.map(p=>p.id===person.id?person:p):[...data.people,person]});
     reset();
   }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar a pessoa.");}
   finally{setBusy(false);}
 }

 async function archive(person:Person){
   if(!confirm("Arquivar esta pessoa? O histórico de lançamentos será preservado."))return;
   setBusy(true);setError("");
   try{await onChange({...data,people:data.people.map(p=>p.id===person.id?archivePerson(p):p)});}
   catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar a pessoa.");}
   finally{setBusy(false);}
 }

 const active=data.people.filter(p=>p.active);
 return <div className="page-content">
   <div className="page-heading"><div><span className="eyebrow">Família</span><h1>Pessoas</h1></div><button className="primary compact" onClick={reset}>+ Nova pessoa</button></div>
   {error&&<div className="global-alert">{error}</div>}
   <section className="panel">
     {active.length===0?<Empty text="Nenhuma pessoa cadastrada."/>:active.map(person=><div className="transaction-row" key={person.id}>
       <div><strong>{person.name}</strong><span>Ativa · usada para atribuir lançamentos e relatórios</span></div>
       <div className="row-actions"><button className="link-button" onClick={()=>edit(person)}>Editar</button><button className="link-button danger" disabled={busy} onClick={()=>void archive(person)}>Arquivar</button></div>
     </div>)}
   </section>
   <section className="panel form-panel">
     <h2>{editing?"Editar pessoa":"Nova pessoa"}</h2>
     <label>Nome<input value={name} maxLength={80} onChange={e=>setName(e.target.value)} placeholder="Ex.: João"/></label>
     <div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar alterações":"Adicionar pessoa"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar</button>}</div>
     <p className="form-note">Arquivar remove a pessoa dos novos lançamentos, mas preserva a atribuição dos lançamentos históricos.</p>
   </section>
 </div>;
}

function More({data,onChange,onSignOut}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>;onSignOut:()=>Promise<void>}) {
 const [section,setSection]=useState<"smart"|"receipt"|"pots"|"recurring"|"budgets"|"assistant"|"people"|"categories"|"settings">("smart");
 return <>{<div className="subnav"><button className={section==="smart"?"active":""} onClick={()=>setSection("smart")}>Entrada inteligente</button><button className={section==="receipt"?"active":""} onClick={()=>setSection("receipt")}>Ler recibo</button><button className={section==="pots"?"active":""} onClick={()=>setSection("pots")}>Caixinhas</button><button className={section==="recurring"?"active":""} onClick={()=>setSection("recurring")}>Recorrências</button><button className={section==="budgets"?"active":""} onClick={()=>setSection("budgets")}>Orçamentos</button><button className={section==="assistant"?"active":""} onClick={()=>setSection("assistant")}>Assistente</button><button className={section==="people"?"active":""} onClick={()=>setSection("people")}>Pessoas</button><button className={section==="categories"?"active":""} onClick={()=>setSection("categories")}>Categorias</button><button className={section==="settings"?"active":""} onClick={()=>setSection("settings")}>Configurações</button></div>}{section==="smart"?<SmartInput data={data} onChange={onChange}/>:section==="receipt"?<ReceiptScanner data={data} onChange={onChange}/>:section==="pots"?<Pots data={data} onChange={onChange}/>:section==="recurring"?<Recurring data={data} onChange={onChange}/>:section==="budgets"?<Budgets data={data} onChange={onChange}/>:section==="assistant"?<Assistant data={data}/>:section==="people"?<People data={data} onChange={onChange}/>:section==="categories"?<Categories data={data} onChange={onChange}/>:<Settings data={data} onChange={onChange} onSignOut={onSignOut}/>}</>;
}

function Cards({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
 const [editing,setEditing]=useState<CreditCard|null>(null),[name,setName]=useState(""),[accountId,setAccountId]=useState(""),[limit,setLimit]=useState(""),[closingDay,setClosingDay]=useState("10"),[dueDay,setDueDay]=useState("20"),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const accounts=data.accounts.filter(a=>a.active);
 function reset(){setEditing(null);setName("");setAccountId("");setLimit("");setClosingDay("10");setDueDay("20");setError("")}
 function edit(c:CreditCard){setEditing(c);setName(c.name);setAccountId(c.accountId);setLimit((c.creditLimitCents/100).toFixed(2).replace(".",","));setClosingDay(String(c.closingDay));setDueDay(String(c.dueDay));setError("")}
 async function save(){setError("");try{const cents=parseAmount(limit),close=Number(closingDay),due=Number(dueDay);if(!name.trim()||!accountId||!Number.isInteger(close)||close<1||close>31||!Number.isInteger(due)||due<1||due>31)throw new Error("Preencha nome, conta e dias válidos.");const card:CreditCard={id:editing?.id??crypto.randomUUID(),name:name.trim(),accountId,creditLimitCents:cents,closingDay:close,dueDay:due,active:true};validateCreditCard(card,data.accounts.map(a=>a.id));const next={...data,cards:editing?data.cards.map(c=>c.id===card.id?card:c):[...data.cards,card]};setBusy(true);await onChange(next);reset()}catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar o cartão.")}finally{setBusy(false)}}
 async function archive(c:CreditCard){if(!confirm("Arquivar este cartão? O histórico será preservado."))return;setBusy(true);setError("");try{await onChange({...data,cards:data.cards.map(x=>x.id===c.id?{...x,active:false}:x)})}catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar.")}finally{setBusy(false)}}
 return <div className="page-content"><div className="page-heading"><div><span className="eyebrow">Crédito</span><h1>Cartões</h1></div><button className="primary compact" onClick={reset}>+ Novo cartão</button></div>{error&&<div className="global-alert">{error}</div>}
 <section className="card-grid">{data.cards.filter(c=>c.active).length===0?<section className="panel"><Empty text="Nenhum cartão cadastrado."/></section>:data.cards.filter(c=>c.active).map(c=>{const available=calculateCardAvailableLimit(c,data.transactions),outstanding=calculateCardOutstanding(c,data.transactions),inv=getCardInvoice(c,data.transactions,todayFinancialDate());return <article className="panel card-item" key={c.id}><div className="card-item-head"><div><strong>{c.name}</strong><span>Fecha dia {c.closingDay} · vence dia {c.dueDay}</span></div><strong>{money(available)}</strong></div><div className="card-metrics"><div><span>Limite</span><strong>{money(c.creditLimitCents)}</strong></div><div><span>Em aberto</span><strong>{money(outstanding)}</strong></div><div><span>Fatura atual</span><strong>{money(inv.openAmountCents)}</strong></div></div><small>Fechamento: {inv.closingDate} · Vencimento: {inv.dueDate}</small><div className="row-actions card-actions"><button className="link-button" onClick={()=>edit(c)}>Editar</button><button className="link-button danger" disabled={busy} onClick={()=>void archive(c)}>Arquivar</button></div></article>})}</section>
 <section className="panel form-panel"><h2>{editing?"Editar cartão":"Novo cartão"}</h2><div className="form-grid"><label>Nome<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Visa principal"/></label><label>Conta para pagamento<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Selecione</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Limite<input inputMode="decimal" value={limit} onChange={e=>setLimit(e.target.value)} placeholder="0,00"/></label><label>Dia de fechamento<input type="number" min="1" max="31" value={closingDay} onChange={e=>setClosingDay(e.target.value)}/></label><label>Dia de vencimento<input type="number" min="1" max="31" value={dueDay} onChange={e=>setDueDay(e.target.value)}/></label></div><div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar alterações":"Criar cartão"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar</button>}</div><p className="form-note">O limite disponível é derivado das compras e pagamentos registrados. O pagamento da fatura sai da conta vinculada.</p></section></div>
}


function AppShell({user,family,onSignOut}:{user:User;family:Family;onSignOut:()=>Promise<void>}) {
  const [page,setPage]=useState<Page>("dashboard");
  const [data,setData]=useState<EntityCollection>(emptyData);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [conflict,setConflict]=useState<{local:EntityCollection;remote:EntityCollection;remoteVersion:number}|null>(null);
  const [remoteVersion,setRemoteVersion]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try {
        const local:EntityCollection={people:await repo.list("people"),categories:await repo.list("categories"),accounts:await repo.list("accounts"),cards:await repo.list("cards"),transactions:await repo.list("transactions"),installmentGroups:await repo.list("installmentGroups"),recurringRules:await repo.list("recurringRules"),pots:await repo.list("pots"),potMovements:await repo.list("potMovements"),budgets:await repo.list("budgets")};
        if(!cancelled)setData(local);
        const remote=await pullFinanceState(family.id);
        if(remote && !cancelled){ await repo.replaceAll(remote.state); setData(remote.state); setRemoteVersion(remote.version); }
      } catch(e){ if(!cancelled)setError(e instanceof Error?e.message:"Falha ao carregar dados."); }
      finally{if(!cancelled)setLoading(false);}
    })();
    return ()=>{cancelled=true};
  },[family.id]);
  async function persist(next:EntityCollection){
    setError("");
    await repo.replaceAll(next); setData(next);
    const result=await pushFromLocalFirst(family.id,next,remoteVersion);
    if(result.kind==="pushed"){setRemoteVersion(result.version);setConflict(null);return;}
    const remote=await pullFinanceState(family.id);
    if(remote){setConflict({local:next,remote:remote.state,remoteVersion:remote.version});setRemoteVersion(remote.version);}
    throw new Error("Conflito de sincronização: outro aparelho alterou os dados online. Escolha abaixo qual estado deve prevalecer.");
  }
  async function keepRemote(){
    if(!conflict)return;
    await repo.replaceAll(conflict.remote); setData(conflict.remote); setRemoteVersion(conflict.remoteVersion); setConflict(null); setError("");
  }
  async function keepLocal(){
    if(!conflict)return;
    setError("");
    const result=await pushFromLocalFirst(family.id,conflict.local,conflict.remoteVersion);
    if(result.kind==="pushed"){setRemoteVersion(result.version);setConflict(null);setError("");return;}
    setError("O estado online mudou novamente. Atualize a tela e resolva o novo conflito.");
  }
  const content = page==="dashboard" ? <Dashboard data={data}/> :
    page==="contas" ? <Accounts data={data} onChange={persist}/> :
    page==="transacoes" ? <Transactions data={data} onChange={persist}/> :
    page==="cartoes" ? <Cards data={data} onChange={persist}/> :
    page==="mais" ? <More data={data} onChange={persist} onSignOut={onSignOut}/> : page==="relatorios" ? <Reports data={data}/> :
    <Dashboard data={data}/>;
  return <div className="shell">
    <header className="topbar"><div><strong>Controle Familiar</strong><span>{family.name}</span></div><button className="icon-button" onClick={()=>void onSignOut()}>Sair</button></header>
    {error && <div className="global-alert">{error}</div>}{conflict && <section className="panel sync-conflict"><strong>Conflito de sincronização</strong><p>Os dados deste aparelho e os dados online são diferentes. Não fazemos mesclagem automática de informações financeiras.</p><div className="form-actions"><button className="secondary compact" onClick={()=>void keepRemote()}>Usar dados online</button><button className="primary compact" onClick={()=>void keepLocal()}>Manter meus dados</button></div></section>}{loading ? <div className="loading">Carregando dados financeiros…</div> : content}
    <nav className="bottom-nav">{([["dashboard","Início","⌂"],["contas","Contas","▣"],["transacoes","Lançamentos","＋"],["cartoes","Cartões","▤"],["relatorios","Relatórios","▥"],["mais","Mais","•••"]] as const).map(([key,label,icon])=><button className={page===key?"active":""} key={key} onClick={()=>setPage(key)} aria-current={page===key?"page":undefined} aria-label={label}><span aria-hidden="true">{icon}</span><small>{label}</small></button>)}</nav>
  </div>;
}

export default function App() {
  const [user,setUser]=useState<User|null>(null);
  const [family,setFamily]=useState<Family|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  useEffect(()=>{
    let alive=true;
    getAuthState().then(s=>{if(alive){setUser(s.user);setLoading(false)}}).catch(e=>{if(alive){setError(e instanceof Error?e.message:"Supabase não configurado.");setLoading(false)}});
    const subscription=onAuthStateChange(s=>{if(alive)setUser(s.user)});
    return ()=>{alive=false;subscription.data.subscription.unsubscribe()};
  },[]);
  if(loading)return <div className="loading full">Carregando…</div>;
  if(error && !user)return <main className="auth-page"><section className="panel"><h1>Configuração necessária</h1><div className="alert error">{error}</div><p className="muted">Defina as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no ambiente do aplicativo.</p></section></main>;
  if(!user)return <AuthScreen onAuthenticated={setUser}/>;
  if(!family)return <FamilyScreen user={user} onReady={setFamily}/>;
  return <AppShell user={user} family={family} onSignOut={async()=>{await signOut();setFamily(null);setUser(null)}}/>;
}