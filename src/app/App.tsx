import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { archivePerson, createPerson, updatePerson } from "../domain/people/person-engine";
import { archiveCategory, createCategory, updateCategory } from "../domain/categories/category-engine";
import type { User } from "@supabase/supabase-js";
import type { EntityCollection } from "../infrastructure/persistence/repository";
import type { Person, Category } from "../domain/types/entities";
import { IndexedDbFinanceRepository, hasLegacyDatabase, readLegacyLocalData } from "../infrastructure/persistence/indexeddb";
import { calculateProjectedAccountBalance, calculateTotalRealBalance, validateAccountArchive, validateAccountUpdate, validateTransaction } from "../domain/transactions/financial-engine";
import { calculateCardAvailableLimit, calculateCardCreditBalance, calculateCardOutstanding, getCardInvoice, allocateCardPayments, invoiceClosingDate, invoiceDueDateFromClosing, validateCreditCard, validateCreditCardArchive, validateCreditCardUpdate } from "../domain/cards/card-engine";
import { getAuthState, onAuthStateChange, signInWithEmail, signOut, signUpWithEmail } from "../infrastructure/supabase/auth";
import { createFamily, joinFamily, listMyFamilies, type Family } from "../infrastructure/supabase/family";
import { pullFinanceState } from "../infrastructure/supabase/sync";
import { pushFromLocalFirst } from "../infrastructure/supabase/sync-coordinator";
import type { Account, AccountType, CreditCard, Transaction, TransactionStatus, TransactionType } from "../domain/types/entities";
import { assertCents } from "../domain/money/cents";
import { buildInstallmentSet, cancelInstallments, getInstallmentNumber } from "../domain/installments/installment-engine";
import { applyRecurringOccurrenceEdit, applyRecurringRuleToFutureTransactions, createRecurringRule, deactivateRecurringRule, generateRecurringTransactions, validateRecurringRuleUpdate, validateRecurringTransactionUpdate } from "../domain/recurring/recurring-engine";
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

function money(cents:number) {
  return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(cents / 100);
}

function displayMoney(cents:number, hidden:boolean) {
  return hidden ? "R$ ••••••" : money(cents);
}

function todayFinancialDate() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

function todayMonth() {
  const d = new Date();
  return d.toLocaleDateString("pt-BR", { month:"long", year:"numeric" });
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

function monthLabel(monthKey:string) {
  const d = new Date(monthKey+"-15T12:00:00");
  const label = d.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
  return label.charAt(0).toUpperCase()+label.slice(1);
}

function monthEndDate(monthKey:string) {
  const [year,month] = monthKey.split("-").map(Number);
  return `${year}-${String(month).padStart(2,"0")}-${String(new Date(year,month,0).getDate()).padStart(2,"0")}`;
}

function projectedAccountBalanceUntil(accountId:string,data:EntityCollection,throughDate?:string) {
  const account=data.accounts.find(a=>a.id===accountId);
  if(!account) return 0;
  let balance=account.openingBalanceCents;
  for(const tx of data.transactions) {
    if(tx.status==="CANCELLED" || (throughDate && tx.date>throughDate)) continue;
    if(tx.type==="INCOME" && tx.accountId===accountId) balance+=tx.amountCents;
    if(tx.type==="EXPENSE" && tx.accountId===accountId) balance-=tx.amountCents;
    if(tx.type==="TRANSFER") {
      if(tx.accountId===accountId) balance-=tx.amountCents;
      if(tx.destinationAccountId===accountId) balance+=tx.amountCents;
    }
    if(tx.type==="CARD_PAYMENT" && tx.accountId===accountId) balance-=tx.amountCents;
  }
  return balance;
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
      if (result.session && result.user) onAuthenticated(result.user);
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
  const [loadingFamilies,setLoadingFamilies]=useState(true);
  const [error,setError]=useState("");

  async function loadFamilies() {
    setLoadingFamilies(true);
    setError("");
    try {
      setFamilies(await listMyFamilies());
    } catch(e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar as famílias.");
    } finally {
      setLoadingFamilies(false);
    }
  }

  useEffect(()=>{ void loadFamilies(); },[]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);setError("");
    try {
      const id=await createFamily(name.trim());
      const created=(await listMyFamilies()).find(f=>f.id===id);
      if(created) onReady(created);
      else setError("Família criada, mas não foi possível carregar seus dados.");
    } catch(e) {
      setError(e instanceof Error?e.message:"Não foi possível criar.");
    } finally {setBusy(false);}
  }

  async function join() {
    if (!code.trim()) return;
    setBusy(true);setError("");
    try {
      const id=await joinFamily(code.trim().toUpperCase());
      const found=(await listMyFamilies()).find(f=>f.id===id);
      if(found) onReady(found);
      else setError("Família vinculada, mas não foi possível carregar seus dados.");
    } catch(e) {
      setError(e instanceof Error?e.message:"Não foi possível entrar.");
    } finally {setBusy(false);}
  }

  return <main className="auth-page"><section className="panel family-panel">
    <div className="family-account">
      <span>Conta conectada</span>
      <strong>{user.email ?? "E-mail não disponível"}</strong>
      <button className="link-button" type="button" onClick={()=>void signOut()}>Sair</button>
    </div>
    <h1>Escolha sua família</h1>
    <p className="muted">A família define o conjunto financeiro que será sincronizado entre os aparelhos.</p>
    {loadingFamilies && <div className="loading">Carregando suas famílias…</div>}
    {!loadingFamilies && families.length>0 && <div className="family-list">{families.map(f=><button key={f.id} className="family-card" onClick={()=>onReady(f)}><strong>{f.name}</strong><span>Família sincronizada</span></button>)}</div>}
    <div className="split-line"><span>ou</span></div>
    <h2>Criar nova família</h2>
    <div className="inline-form"><input placeholder="Ex.: Nossa casa" value={name} onChange={e=>setName(e.target.value)} disabled={busy}/><button className="primary" disabled={busy||!name.trim()} onClick={create}>Criar</button></div>
    <h2>Entrar com código</h2>
    <div className="inline-form"><input placeholder="Código de convite" value={code} onChange={e=>setCode(e.target.value)} disabled={busy}/><button className="secondary" disabled={busy||!code.trim()} onClick={join}>Entrar</button></div>
    {error && <div className="alert error">{error}<button className="link-button" type="button" onClick={()=>void loadFamilies()}>Tentar novamente</button></div>}
  </section></main>;
}
function Dashboard({data,onQuickAction,hideValues,onToggleHideValues,syncStatus,theme,onThemeChange}:{data:EntityCollection;onQuickAction:(mode:"smart"|"receipt"|"manual")=>void;hideValues:boolean;onToggleHideValues:()=>void;syncStatus:"syncing"|"synced"|"conflict"|"error";theme:"light"|"dark";onThemeChange:(theme:"light"|"dark")=>void}) {
  const [planningPeriod,setPlanningPeriod]=useState(currentMonthKey());
  const periodOptions=useMemo(()=>{
    const months=new Set<string>([currentMonthKey()]);
    data.transactions.forEach(tx=>months.add(tx.date.slice(0,7)));
    return [...months].sort();
  },[data.transactions]);

  const real=useMemo(()=>calculateTotalRealBalance({accounts:data.accounts,cards:data.cards,transactions:data.transactions}),[data]);
  const throughDate=planningPeriod==="ALL" ? undefined : monthEndDate(planningPeriod);
  const projected=useMemo(()=>data.accounts.filter(a=>a.active).reduce((sum,a)=>sum+projectedAccountBalanceUntil(a.id,data,throughDate),0),[data,throughDate]);
  const planned=useMemo(()=>data.transactions
    .filter(t=>(planningPeriod==="ALL"||t.date.startsWith(planningPeriod))&&(t.status==="PENDING"||t.status==="PLANNED"))
    .reduce((sum,t)=>sum+(t.type==="EXPENSE"||t.type==="CARD_PAYMENT"?-t.amountCents:t.type==="INCOME"?t.amountCents:0),0),[data.transactions,planningPeriod]);

  return <div className="page-content">
    <div className="page-heading"><div><span className="eyebrow">{planningPeriod==="ALL"?"Planejamento completo":monthLabel(planningPeriod)}</span><h1>Visão geral</h1></div><div className="dashboard-heading-actions"><button className="value-visibility-button" type="button" onClick={onToggleHideValues} aria-label={hideValues?"Mostrar valores financeiros":"Ocultar valores financeiros"} title={hideValues?"Mostrar valores":"Ocultar valores"}><svg className="visibility-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/></svg><span>{hideValues?"Mostrar":"Ocultar"}</span></button><button className="theme-toggle-button" type="button" onClick={()=>onThemeChange(theme==="dark"?"light":"dark")} aria-label={theme==="dark"?"Ativar modo claro":"Ativar modo escuro"} title={theme==="dark"?"Ativar modo claro":"Ativar modo escuro"}><span aria-hidden="true">{theme==="dark"?"☀":"☾"}</span></button><span className={`sync-dot sync-${syncStatus}`}>{syncStatus==="syncing"?"Sincronizando…":syncStatus==="conflict"?"Conflito":syncStatus==="error"?"Erro de sincronização":"Sincronizado"}</span></div></div>
    <section className="quick-actions">
      <button className="quick-action quick-action-primary" onClick={()=>onQuickAction("smart")}><span className="quick-action-icon" aria-hidden="true">🎙</span><span><strong>Lançar com áudio</strong><small>Fale o gasto e revise antes de salvar</small></span><b aria-hidden="true">›</b></button>
      <button className="quick-action" onClick={()=>onQuickAction("receipt")}><span className="quick-action-icon" aria-hidden="true">📷</span><span><strong>Fotografar recibo</strong><small>Leia o valor e confira o lançamento</small></span><b aria-hidden="true">›</b></button>
      <button className="quick-action" onClick={()=>onQuickAction("manual")}><span className="quick-action-icon" aria-hidden="true">＋</span><span><strong>Novo lançamento</strong><small>Digite e registre uma movimentação</small></span><b aria-hidden="true">›</b></button>
    </section>
    <section className="hero-card"><span>Saldo total real</span><strong>{displayMoney(real,hideValues)}</strong><small>Somente movimentos pagos/recebidos.</small></section>
    <section className="panel form-panel">
      <div className="section-title"><div><h2>Planejamento</h2><span>Escolha o período que deseja enxergar na visão inicial.</span></div></div>
      <label>Filtrar por mês
        <select value={planningPeriod} onChange={e=>setPlanningPeriod(e.target.value)}>
          {periodOptions.map(month=><option key={month} value={month}>{month===currentMonthKey()?"Mês atual · ":""}{monthLabel(month)}</option>)}
          <option value="ALL">Todos os meses · todo o planejamento gerado</option>
        </select>
      </label>
    </section>
    <div className="metric-grid">
      <article className="metric"><span>Saldo projetado</span><strong>{displayMoney(projected,hideValues)}</strong><small>{planningPeriod==="ALL"?"Considera todo o planejamento já gerado.":`Projeção até o fim de ${monthLabel(planningPeriod)}.`}</small></article>
      <article className="metric"><span>Planejado no período</span><strong>{displayMoney(planned,hideValues)}</strong><small>Somente pendentes e planejados do período selecionado.</small></article>
    </div>
    <section className="panel"><div className="section-title"><h2>Contas</h2><span>{data.accounts.filter(a=>a.active).length} ativas</span></div>
      {data.accounts.filter(a=>a.active).length===0 ? <Empty text="Nenhuma conta cadastrada ainda."/> : <div className="account-list">{data.accounts.filter(a=>a.active).map(a=><div className="account-row dashboard-account-row" key={a.id}><div className="account-identity"><InstitutionMark institution={a.institution} name={a.name}/><span className="account-name-group"><strong>{a.name}</strong><small>{accountTypeLabel(a.type)}</small></span></div><strong>{displayMoney(projectedAccountBalanceUntil(a.id,data,throughDate),hideValues)}</strong></div>)}</div>}
    </section>
  </div>;
}

function Empty({text}:{text:string}) { return <div className="empty">{text}</div>; }

function Accounts({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
  const [editing,setEditing]=useState<Account|null>(null);
  const [name,setName]=useState(""); const [type,setType]=useState<AccountType>("CHECKING"); const [opening,setOpening]=useState(""); const [institution,setInstitution]=useState("none");
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  function reset(){setEditing(null);setName("");setType("CHECKING");setOpening("");setInstitution("none");setError("");}
  function edit(a:Account){setEditing(a);setName(a.name);setType(a.type);setOpening((a.openingBalanceCents/100).toFixed(2).replace(".",","));setInstitution(a.institution??"none");setError("");}
  async function save(){
    setError(""); const value=Number(opening.replace(/\\./g,"").replace(",","."));
    if(!name.trim()||!Number.isFinite(value)||value<0){setError("Informe nome e saldo inicial válido.");return;}
    const cents=Math.round(value*100); try{assertCents(cents,"openingBalanceCents")}catch(e){setError(e instanceof Error?e.message:"Valor inválido.");return;}
    const account:Account={id:editing?.id ?? crypto.randomUUID(),name:name.trim(),type,openingBalanceCents:cents,active:true,institution};
    if(editing) validateAccountUpdate(editing,account,data.transactions);
    const next={...data,accounts:editing?data.accounts.map(a=>a.id===account.id?account:a):[...data.accounts,account]};
    setBusy(true);try{await onChange(next);reset();}catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar.");}finally{setBusy(false);}
  }
  async function archive(a:Account){
    if(!confirm("Arquivar a conta \"" + a.name + "\"? O histórico será preservado."))return;
    try{validateAccountArchive(a,{accounts:data.accounts,cards:data.cards,transactions:data.transactions},data.recurringRules)}catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar.");return;}
    setBusy(true);setError("");try{await onChange({...data,accounts:data.accounts.map(x=>x.id===a.id?{...x,active:false}:x)});}catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar.");}finally{setBusy(false);}
  }
  async function reactivate(a:Account){
    setBusy(true);setError("");
    try{await onChange({...data,accounts:data.accounts.map(x=>x.id===a.id?{...x,active:true}:x)});}
    catch(e){setError(e instanceof Error?e.message:"Não foi possível reativar a conta.");}
    finally{setBusy(false)}
  }
  return <div className="page-content">
    <div className="page-heading"><div><span className="eyebrow">Patrimônio</span><h1>Contas</h1></div><button className="primary compact" onClick={reset}>+ Nova conta</button></div>
    {error&&<div className="global-alert">{error}</div>}
    <section className="panel account-list">{data.accounts.filter(a=>a.active).length===0?<Empty text="Nenhuma conta ativa. Cadastre a primeira conta para começar."/>:data.accounts.filter(a=>a.active).map(a=><div className="account-row account-management-row" key={a.id}><div className="account-identity"><InstitutionMark institution={a.institution} name={a.name}/><span className="account-name-group"><strong>{a.name}</strong><small>{accountTypeLabel(a.type)} · Saldo inicial {money(a.openingBalanceCents)}</small></span></div><div className="row-actions"><strong>{money(calculateProjectedAccountBalance(a.id,{accounts:data.accounts,cards:data.cards,transactions:data.transactions}))}</strong><button className="link-button" onClick={()=>edit(a)}>Editar</button><button className="link-button danger" onClick={()=>void archive(a)} disabled={busy}>Arquivar</button></div></div>)}</section>
    {data.accounts.some(a=>!a.active)&&<section className="panel archived-panel"><div className="section-title"><div><h2>Contas arquivadas</h2><span>O histórico permanece preservado.</span></div></div><div className="account-list">{data.accounts.filter(a=>!a.active).map(a=><div className="account-row account-management-row" key={a.id}><div className="account-identity"><InstitutionMark institution={a.institution} name={a.name}/><span className="account-name-group"><strong>{a.name}</strong><small>{accountTypeLabel(a.type)} · Saldo inicial {money(a.openingBalanceCents)}</small></span></div><button className="secondary compact" disabled={busy} onClick={()=>void reactivate(a)}>Reativar</button></div>)}</div></section>}
    <section className="panel form-panel"><h2>{editing?"Editar conta":"Nova conta"}</h2>
      <div className="form-grid"><label>Nome<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Banco principal"/></label>
      <label>Tipo<select value={type} onChange={e=>setType(e.target.value as AccountType)}><option value="CHECKING">Conta corrente</option><option value="SAVINGS">Poupança</option><option value="DIGITAL">Conta digital</option><option value="CASH">Dinheiro</option><option value="INVESTMENT">Investimento</option></select></label>
      <label>Instituição<select value={institution} onChange={e=>setInstitution(e.target.value)}>{INSTITUTIONS.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Saldo inicial<input inputMode="decimal" value={opening} onChange={e=>setOpening(e.target.value)} placeholder="0,00"/></label></div>
      <div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar alterações":"Criar conta"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar</button>}</div>
    </section>
  </div>;
}

const INSTITUTIONS=[{id:"none",name:"Dinheiro / outra"},{id:"itau",name:"Itaú"},{id:"bradesco",name:"Bradesco"},{id:"bb",name:"Banco do Brasil"},{id:"caixa",name:"Caixa"},{id:"santander",name:"Santander"},{id:"nubank",name:"Nubank"},{id:"inter",name:"Inter"},{id:"c6",name:"C6 Bank"},{id:"sicredi",name:"Sicredi"},{id:"sicoob",name:"Sicoob"},{id:"mercadopago",name:"Mercado Pago"},{id:"picpay",name:"PicPay"},{id:"other",name:"Outro banco"}] as const;
function accountTypeLabel(type:AccountType){return ({CHECKING:"Conta corrente",SAVINGS:"Poupança",DIGITAL:"Conta digital",CASH:"Dinheiro",INVESTMENT:"Investimento"})[type]}
function InstitutionMark({institution,name}:{institution?:string;name:string}){const meta=INSTITUTIONS.find(item=>item.id===institution)??INSTITUTIONS[0];const initials=meta.id==="none"?(name.trim().slice(0,1).toLocaleUpperCase("pt-BR")||"$"):meta.id==="bb"?"BB":meta.id==="c6"?"C6":meta.id==="mercadopago"?"MP":meta.id==="bradesco"?"br":meta.id==="santander"?"S":meta.id==="nubank"?"nu":meta.id==="itau"?"itaú":meta.id==="picpay"?"P":meta.id==="sicredi"?"si":meta.id==="sicoob"?"sc":meta.id==="caixa"?"cx":meta.id==="inter"?"in":"$";return <span className={`institution-mark institution-${meta.id}`} aria-label={meta.name} title={meta.name}>{initials}</span>}

function parseAmount(value:string):number{const cents=parseSmartAmount(value);if(cents===null)throw new Error("Informe um valor válido.");assertCents(cents,"amountCents");return cents}

const CATEGORY_EMOJIS=["🏷️","🛒","🍔","🏠","🚗","💊","🎓","👕","🎮","💡","📱","💰","🐶","👶","📦","🔧","📚","🎁","✈️"];
const CATEGORY_CREATE_VALUE="__CREATE_CATEGORY__";
const CATEGORY_NAME_EMOJIS:Record<string,string>={
 "alimentação":"🍔","alimentacao":"🍔","mercado":"🛒","moradia":"🏠","transporte":"🚗","saúde":"💊","saude":"💊",
 "educação":"🎓","educacao":"🎓","vestuário":"👕","vestuario":"👕","lazer":"🎮","contas da casa":"💡",
 "assinaturas":"📱","investimentos":"💰","pets":"🐶","filhos":"👶","bens":"📦","serviços":"🔧","servicos":"🔧",
 "presentes":"🎁","viagem":"✈️","cartão":"💳","cartao":"💳","salário":"💰","salario":"💰"
};
function categoryEmojiForName(name:string){return CATEGORY_NAME_EMOJIS[name.trim().toLocaleLowerCase("pt-BR")]??"🏷️";}
function normalizeCategoryEmojis(categories:Category[]):Category[]{
 return categories.map(c=>c.emoji?c:{...c,emoji:categoryEmojiForName(c.name)});
}

function QuickCategoryCreate({kind,data,onChange,onCreated,onCancel}:{kind:Category["kind"];data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>;onCreated:(category:Category)=>void;onCancel:()=>void}) {
 const [name,setName]=useState("");
 const [emoji,setEmoji]=useState("🏷️");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 async function save(){
   setError("");
   try{
     const category=createCategory(name,kind,data,emoji);
     setBusy(true);
     await onChange({...data,categories:[...data.categories,category]});
     onCreated(category);
   }catch(e){setError(e instanceof Error?e.message:"Não foi possível criar a categoria.");}
   finally{setBusy(false);}
 }
 return <div className="category-create-panel">
   <div className="category-create-head"><strong>Nova categoria</strong><button type="button" className="link-button" onClick={onCancel}>Fechar</button></div>
   <div className="category-create-grid"><label>Nome<input autoFocus value={name} maxLength={60} onChange={e=>setName(e.target.value)} placeholder="Ex.: Bens"/></label><label>Emoji<input value={emoji} maxLength={8} onChange={e=>setEmoji(e.target.value)} aria-label="Emoji da categoria"/></label></div>
   <div className="emoji-picker" aria-label="Escolha um emoji">{CATEGORY_EMOJIS.map(item=><button type="button" key={item} className={emoji===item?"emoji-option selected":"emoji-option"} onClick={()=>setEmoji(item)} aria-label={"Usar emoji "+item}>{item}</button>)}</div>
   {error&&<div className="alert error">{error}</div>}
   <div className="form-actions"><button type="button" className="primary compact" disabled={busy} onClick={()=>void save()}>{busy?"Criando…":"Criar e usar categoria"}</button><button type="button" className="secondary compact" onClick={onCancel}>Cancelar</button></div>
 </div>;
}

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
 const [creatingCategory,setCreatingCategory]=useState(false);
 const [filter,setFilter]=useState<"ALL"|"INCOME"|"EXPENSE"|"TRANSFER"|"CARD_PAYMENT">("ALL");
 const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 const [pendingRecurringEdit,setPendingRecurringEdit]=useState<{previous:Transaction;next:Transaction}|null>(null);
 const [view,setView]=useState<"new"|"history">("new");
 const [launchMode,setLaunchMode]=useState<"unique"|"recurring">("unique");
 const transactionAccountOptions=data.accounts.filter(a=>a.active||a.id===editing?.accountId||a.id===editing?.destinationAccountId),activeCards=data.cards.filter(c=>c.active),transactionCardOptions=data.cards.filter(c=>c.active||c.id===editing?.creditCardId),paymentCardOptions=data.cards.filter(c=>c.active||c.id===editing?.creditCardId),transactionPeopleOptions=data.people.filter(p=>p.active||p.id===editing?.personId);
 const recurringGenerated=!!editing&&data.recurringRules.some(rule=>rule.transactionIds.includes(editing.id));
 const visible=data.transactions.filter(t=>filter==="ALL"||t.type===filter).sort((a,b)=>b.date.localeCompare(a.date));

 function reset(){setPendingRecurringEdit(null);setEditing(null);setLaunchMode("unique");setType("EXPENSE");setStatus("PAID");setDate(todayFinancialDate());setAmount("");setDescription("");setCategoryId("");setAccountId("");setDestinationAccountId("");setCreditCardId("");setPersonId("");setInstallments("2");setParcelado(false);setCreatingCategory(false);setError("");setView("new")}
 function edit(t:Transaction){
   if(t.installmentGroupId){setError("Parcelas vinculadas devem ser gerenciadas pelo grupo. Use os comandos de cancelamento abaixo.");return;}
   setEditing(t);setType(t.type);setStatus(t.status==="CANCELLED" ? (t.type==="INCOME" ? "RECEIVED" : "PAID") : t.status);setDate(t.date);setAmount((t.amountCents/100).toFixed(2).replace(".",","));setDescription(t.description);setCategoryId(t.categoryId??"");setAccountId(t.accountId??"");setDestinationAccountId(t.destinationAccountId??"");setCreditCardId(t.creditCardId??"");setPersonId(t.personId??"");setParcelado(false);setError("");setView("new");setLaunchMode("unique")
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
     const transactionDescription=description.trim() || (type==="TRANSFER" ? "Transferência" : "");
     const tx:Transaction={id:editing?.id??crypto.randomUUID(),date,type,status,amountCents,description:transactionDescription,...(categoryId?{categoryId}:{}),...(accountId?{accountId}:{}),...(destinationAccountId?{destinationAccountId}:{}),...(creditCardId?{creditCardId}:{}),...(personId?{personId}: {})};
     if(type==="EXPENSE"&&creditCardId){
       const card=data.cards.find(c=>c.id===creditCardId); if(!card) throw new Error("Cartão inválido.");
       const available=calculateCardAvailableLimit(card,data.transactions)+(editing?.creditCardId===card.id&&editing.type==="EXPENSE"?editing.amountCents:0);
       if(amountCents>available) throw new Error(`Limite disponível insuficiente. Disponível: ${money(available)}.`);
     }
     validateTransaction(tx,{accounts:data.accounts,cards:data.cards,transactions:data.transactions});
     if(editing&&recurringGenerated){
       const changed=editing.date!==tx.date||editing.amountCents!==tx.amountCents||editing.description!==tx.description||editing.status!==tx.status||editing.categoryId!==tx.categoryId||editing.accountId!==tx.accountId||editing.destinationAccountId!==tx.destinationAccountId||editing.creditCardId!==tx.creditCardId||editing.personId!==tx.personId;
       if(changed){setPendingRecurringEdit({previous:editing,next:tx});return;}
     } else if(editing) validateRecurringTransactionUpdate(editing,tx,data.recurringRules);
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
   <div className="page-heading"><div><span className="eyebrow">Movimentação</span><h1>Lançamentos</h1></div><button className="primary compact" onClick={reset}>+ Novo lançamento</button></div>
   <div className="subnav transaction-tabs"><button className={view==="new"?"active":""} onClick={()=>{setView("new");setError("")}}>Novo lançamento</button><button className={view==="history"?"active":""} onClick={()=>{setView("history");setError("")}}>Lançamentos feitos <span>({data.transactions.length})</span></button></div>
   {error&&<div className="global-alert">{error}</div>}
   {view==="new"&&<div className="subnav launch-mode-tabs"><button className={launchMode==="unique"?"active":""} onClick={()=>{if(editing)return;setLaunchMode("unique");setError("")}}>Lançamento único</button><button className={launchMode==="recurring"?"active":""} onClick={()=>{if(editing)return;setLaunchMode("recurring");setError("")}}>Lançamento recorrente</button></div>}
   {pendingRecurringEdit&&<section className="panel recurring-edit-choice"><div className="section-title"><div><span className="eyebrow">Ocorrência recorrente</span><h2>Como aplicar esta alteração?</h2><p className="form-note">A data agendada desta ocorrência será preservada. Você pode alterar apenas esta ocorrência ou aplicar a mudança a ela e às próximas.</p></div></div><div className="form-actions"><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await onChange(applyRecurringOccurrenceEdit(data,pendingRecurringEdit.previous,pendingRecurringEdit.next,"ONLY_THIS"));reset()}catch(e){setError(e instanceof Error?e.message:"Não foi possível ajustar a ocorrência.")}finally{setBusy(false)}}}>Somente este lançamento</button><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await onChange(applyRecurringOccurrenceEdit(data,pendingRecurringEdit.previous,pendingRecurringEdit.next,"THIS_AND_FOLLOWING"));reset()}catch(e){setError(e instanceof Error?e.message:"Não foi possível aplicar aos próximos.")}finally{setBusy(false)}}}>Este e os próximos</button><button className="secondary" disabled={busy} onClick={()=>setPendingRecurringEdit(null)}>Cancelar</button></div></section>}
   {view==="history"&&<><div className="transaction-filters">{(["ALL","INCOME","EXPENSE","TRANSFER","CARD_PAYMENT"] as const).map(f=><button key={f} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f==="ALL"?"Todos":f==="INCOME"?"Entradas":f==="EXPENSE"?"Saídas":f==="TRANSFER"?"Transferências":"Cartão"}</button>)}</div>
   <section className="panel transaction-list">{visible.length===0?<Empty text="Nenhum lançamento encontrado."/>:visible.map(t=>{
     const group=t.installmentGroupId?data.installmentGroups.find(g=>g.id===t.installmentGroupId):undefined;
     const n=group?getInstallmentNumber(group,t.id):undefined;
     const recurringRule=data.recurringRules.find(rule=>rule.transactionIds.includes(t.id));
     return <div className={recurringRule?"transaction-row transaction-row-recurring":"transaction-row"} key={t.id}><div><strong>{t.description||labelType(t)}{recurringRule&&<span className="transaction-recurring-badge">↻ Recorrente</span>}</strong><span>{t.date}{t.scheduledDate&&t.scheduledDate!==t.date?` · agendada ${t.scheduledDate}`:""} · {labelType(t)} · {t.status}{group&&` · Parcela ${n}/${group.installmentCount}`}</span></div>
       <div className="transaction-value"><strong>{t.type==="EXPENSE"||t.type==="CARD_PAYMENT"?"−":"+"}{money(t.amountCents)}</strong><div className="row-actions">
         {group ? <>{t.status!=="CANCELLED"&&<><button className="link-button danger" disabled={busy} onClick={()=>void cancelGroup(t,"ONE")}>Cancelar</button><button className="link-button danger" disabled={busy} onClick={()=>void cancelGroup(t,"THIS_AND_FOLLOWING")}>+ seguintes</button></>} </> :
           <>{<button className="link-button" onClick={()=>edit(t)}>Editar</button>}{t.status!=="CANCELLED"&&<button className="link-button danger" disabled={busy} onClick={()=>void cancel(t)}>Cancelar</button>}</>}
       </div></div></div>
   })}</section></>}
   {view==="new"&&launchMode==="recurring"&&!editing&&<Recurring data={data} onChange={onChange} embedded onCreated={()=>setLaunchMode("unique")} onCancel={()=>setLaunchMode("unique")}/>}
   {view==="new"&&launchMode==="unique"&&<section className="panel form-panel"><h2>{editing?"Editar lançamento":"Novo lançamento"}</h2><div className="form-grid">
     <label>Tipo<select value={type} disabled={!!editing} aria-describedby={editing?"transaction-type-lock-note":undefined} onChange={e=>{const v=e.target.value as TransactionType;setType(v);setCategoryId("");setCreditCardId("");if(v!=="EXPENSE")setParcelado(false)}}><option value="EXPENSE">Saída</option><option value="INCOME">Entrada</option><option value="TRANSFER">Transferência</option><option value="CARD_PAYMENT">Pagamento de cartão</option></select></label>
     <>{editing&&<p id="transaction-type-lock-note" className="form-note">O tipo do lançamento não pode ser alterado depois de criado. Para mudar a natureza financeira, cancele este lançamento e registre outro.</p>}</><label>Status<select value={status} onChange={e=>setStatus(e.target.value as RecurringRule["status"])}>{type==="INCOME"?<><option value="RECEIVED">Recebido</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>:<><option value="PAID">Pago</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>}</select></label>
     <label>Data<input type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={recurringGenerated} required/></label>
     <label>Valor total<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0,00" required/></label>
     <label>Descrição<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Ex.: Mercado"/></label>
     {(type==="INCOME"||type==="EXPENSE")&&<div className="category-field"><label>Categoria<select value={categoryId} onChange={e=>{if(e.target.value===CATEGORY_CREATE_VALUE){setCreatingCategory(true);return;}setCategoryId(e.target.value)}}><option value="">Selecione</option>{data.categories.filter(c=>(c.active&&c.kind===(type==="INCOME"?"INCOME":"EXPENSE"))||c.id===editing?.categoryId).map(c=><option key={c.id} value={c.id}>{c.emoji??categoryEmojiForName(c.name)} {c.name}{c.active?"":" (arquivada)"}</option>)}<option value={CATEGORY_CREATE_VALUE}>＋ Criar nova categoria…</option></select></label><button type="button" className="secondary compact category-add-button" onClick={()=>setCreatingCategory(v=>!v)}>＋ Criar nova categoria</button>{creatingCategory&&<QuickCategoryCreate kind={type==="INCOME"?"INCOME":"EXPENSE"} data={data} onChange={onChange} onCreated={category=>{setCategoryId(category.id);setCreatingCategory(false);}} onCancel={()=>setCreatingCategory(false)}/>}</div>}
     <label>{type==="TRANSFER"?"Conta de origem":type==="CARD_PAYMENT"?"Conta de pagamento":"Conta"}<select value={accountId} onChange={e=>{setAccountId(e.target.value);if(e.target.value&&type!=="CARD_PAYMENT")setCreditCardId("")}} disabled={type==="CARD_PAYMENT"&&!!creditCardId}><option value="">Selecione</option>{(type==="CARD_PAYMENT"&&creditCardId?data.accounts.filter(a=>a.id===data.cards.find(c=>c.id===creditCardId)?.accountId ):transactionAccountOptions).map(a=><option key={a.id} value={a.id}>{a.name}{a.active?"":" (arquivada)"}</option>)}</select></label>
     {type==="TRANSFER"&&<label>Conta de destino<select value={destinationAccountId} onChange={e=>setDestinationAccountId(e.target.value)}><option value="">Selecione</option>{transactionAccountOptions.map(a=><option key={a.id} value={a.id}>{a.name}{a.active?"":" (arquivada)"}</option>)}</select></label>}
     {type==="EXPENSE"&&<label>Cartão de crédito (opcional)<select value={creditCardId} onChange={e=>{setCreditCardId(e.target.value);if(e.target.value)setAccountId("")}}><option value="">Nenhum / conta</option>{transactionCardOptions.map(c=><option key={c.id} value={c.id}>{c.name}{c.active?"":" (arquivado)"}</option>)}</select></label>}
     {type==="CARD_PAYMENT"&&<label>Cartão<select value={creditCardId} onChange={e=>{const id=e.target.value;setCreditCardId(id);const card=data.cards.find(c=>c.id===id);setAccountId(card?.accountId??"")}}><option value="">Selecione</option>{paymentCardOptions.map(c=><option key={c.id} value={c.id}>{c.name}{c.active?"":" (arquivado)"}</option>)}</select></label>}
     {type!=="TRANSFER"&&<label>Pessoa (opcional)<select value={personId} onChange={e=>setPersonId(e.target.value)}><option value="">Nenhuma</option>{transactionPeopleOptions.map(p=><option key={p.id} value={p.id}>{p.name}{p.active?"":" (arquivada)"}</option>)}</select></label>}
     {type==="EXPENSE"&&<label className="checkbox-field"><input type="checkbox" checked={parcelado} onChange={e=>setParcelado(e.target.checked)} disabled={!!editing}/> Parcelar esta saída</label>}
     {parcelado&&<label>Número de parcelas<input type="number" min="2" max="120" value={installments} onChange={e=>setInstallments(e.target.value)}/></label>}
   </div>
   {parcelado&&<p className="form-note">O valor informado é o total da compra. As parcelas são geradas mensalmente, com o eventual centavo restante distribuído nas primeiras parcelas. Em compras no cartão, cada parcela entra na fatura correspondente à sua data.</p>}
   <div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar alterações":"Registrar lançamento"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar edição</button>}</div>
   {!parcelado&&<p className="form-note">Compra no cartão não reduz a conta. O pagamento da fatura movimenta a conta e não cria outra despesa.</p>}
   </section>}
 </div>;
}

function Recurring({data,onChange,embedded=false,onCreated,onCancel}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>;embedded?:boolean;onCreated?:()=>void;onCancel?:()=>void}) {
 const [editing,setEditing]=useState<RecurringRule|null>(null);
 const [description,setDescription]=useState("");
 const [frequency,setFrequency]=useState<RecurringFrequency>("MONTHLY");
 const [startDate,setStartDate]=useState(()=>todayFinancialDate());
 const [endDate,setEndDate]=useState("");
 const [amount,setAmount]=useState("");
 const [type,setType]=useState<"INCOME"|"EXPENSE">("EXPENSE");
 const [status,setStatus]=useState<"PENDING"|"PAID"|"RECEIVED"|"PLANNED">("PLANNED");
 const [accountId,setAccountId]=useState("");
 const [creditCardId,setCreditCardId]=useState("");
 const [categoryId,setCategoryId]=useState("");
 const [personId,setPersonId]=useState("");
 const [creatingCategory,setCreatingCategory]=useState(false);
 const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 const activeAccounts=data.accounts.filter(a=>a.active),activeCards=data.cards.filter(c=>c.active),activePeople=data.people.filter(p=>p.active);
 const activeCategories=data.categories.filter(c=>c.active&&c.kind===type);
 function reset(){setEditing(null);setDescription("");setFrequency("MONTHLY");setStartDate(todayFinancialDate());setEndDate("");setAmount("");setType("EXPENSE");setStatus("PLANNED");setAccountId("");setCreditCardId("");setCategoryId("");setPersonId("");setCreatingCategory(false);setError("")}
 function edit(rule:RecurringRule){
   setEditing(rule);setDescription(rule.description);setFrequency(rule.frequency);setStartDate(rule.startDate);setEndDate(rule.endDate??"");setAmount((rule.amountCents/100).toFixed(2).replace(".",","));setType(rule.type);setStatus(rule.status);setAccountId(rule.accountId??"");setCreditCardId(rule.creditCardId??"");setCategoryId(rule.categoryId??"");setPersonId(rule.personId??"");setCreatingCategory(false);setError("");
 }
 async function save(){
   setError("");
   try{
     const cents=parseAmount(amount);
     if(type==="EXPENSE"&&!accountId&&!creditCardId) throw new Error("Despesa recorrente precisa de conta ou cartão.");
     if(accountId&&creditCardId) throw new Error("Use conta ou cartão, não ambos.");
     if(editing){
       const replacement:RecurringRule={...editing,description:description.trim(),frequency,startDate,endDate:endDate||undefined,amountCents:cents,type,status,accountId:accountId||undefined,creditCardId:creditCardId||undefined,categoryId:categoryId||undefined,personId:personId||undefined};
       validateRecurringRuleUpdate(editing,replacement);
       const propagated=applyRecurringRuleToFutureTransactions(data,editing,replacement,todayFinancialDate());
       const next={...propagated,recurringRules:propagated.recurringRules.map(r=>r.id===editing.id?replacement:r)};
       setBusy(true);await onChange(next);reset();onCreated?.();return;
     }
     const created=createRecurringRule({description,frequency,startDate,endDate:endDate||undefined,amountCents:cents,type,status,accountId:accountId||undefined,creditCardId:creditCardId||undefined,categoryId:categoryId||undefined,personId:personId||undefined,active:true});
     const horizon=new Date(); horizon.setMonth(horizon.getMonth()+12);
     const horizonDate=`${horizon.getFullYear()}-${String(horizon.getMonth()+1).padStart(2,"0")}-${String(horizon.getDate()).padStart(2,"0")}`;
     const generated=generateRecurringTransactions({...data,recurringRules:[...data.recurringRules,created]},created,horizonDate);
     setBusy(true);await onChange(generated.data);reset();onCreated?.();
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
   {!embedded&&<><div className="page-heading"><div><span className="eyebrow">Automação</span><h1>Recorrências</h1></div><button className="primary compact" onClick={reset}>+ Nova recorrência</button></div>
   <section className="panel transaction-list">{data.recurringRules.filter(r=>r.active).length===0?<Empty text="Nenhuma recorrência ativa."/>:data.recurringRules.filter(r=>r.active).map(r=><div className="transaction-row" key={r.id}><div><strong>{r.description}</strong><span>{frequencyLabel(r.frequency)} · desde {r.startDate} · {money(r.amountCents)} · {r.transactionIds.length} lançamentos gerados</span></div><div className="row-actions"><button className="link-button" onClick={()=>edit(r)}>Editar regra</button><button className="link-button" disabled={busy} onClick={()=>void generate(r)}>Gerar próximos</button><button className="link-button danger" disabled={busy} onClick={()=>void deactivate(r)}>Desativar</button></div></div>)}</section></>}
   {error&&<div className="global-alert">{error}</div>}
   <section className="panel form-panel"><h2>{editing?"Editar recorrência":embedded?"Lançamento recorrente":"Nova recorrência"}</h2><div className="form-grid">
    <label>Tipo<select value={type} onChange={e=>{const v=e.target.value as "INCOME"|"EXPENSE";setType(v);setCategoryId("");if(v==="INCOME")setCreditCardId("")}}><option value="EXPENSE">Saída</option><option value="INCOME">Entrada</option></select></label>
    <label>Frequência<select value={frequency} onChange={e=>setFrequency(e.target.value as RecurringFrequency)}><option value="WEEKLY">Semanal</option><option value="BIWEEKLY">Quinzenal</option><option value="MONTHLY">Mensal</option><option value="BIMONTHLY">Bimestral</option><option value="QUARTERLY">Trimestral</option><option value="SEMIANNUAL">Semestral</option><option value="ANNUAL">Anual</option></select></label>
    <label>Data inicial<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
    <label>Data final (opcional)<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
    <label>Valor<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0,00"/></label>
    <label>Status<select value={status} onChange={e=>{const v=e.target.value;if(v==="PENDING"||v==="PAID"||v==="RECEIVED"||v==="PLANNED")setStatus(v)}}>{type==="INCOME"?<><option value="RECEIVED">Recebido</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>:<><option value="PAID">Pago</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>}</select></label>
    <label>Descrição<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Ex.: Aluguel"/></label>
    <label>Categoria<select value={creatingCategory?CATEGORY_CREATE_VALUE:categoryId} onChange={e=>{if(e.target.value===CATEGORY_CREATE_VALUE){setCreatingCategory(true);return}setCreatingCategory(false);setCategoryId(e.target.value)}}><option value="">Nenhuma</option>{activeCategories.map(c=><option key={c.id} value={c.id}>{c.emoji??"🏷️"} {c.name}</option>)}<option value={CATEGORY_CREATE_VALUE}>＋ Criar nova categoria…</option></select></label>
    <label>Conta<select value={accountId} onChange={e=>{setAccountId(e.target.value);if(e.target.value)setCreditCardId("")}}><option value="">Nenhuma</option>{activeAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    {type==="EXPENSE"&&<label>Cartão<select value={creditCardId} onChange={e=>{setCreditCardId(e.target.value);if(e.target.value)setAccountId("")}}><option value="">Nenhum</option>{activeCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    <label>Pessoa (opcional)<select value={personId} onChange={e=>setPersonId(e.target.value)}><option value="">Nenhuma</option>{activePeople.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   {creatingCategory&&<QuickCategoryCreate kind={type==="INCOME"?"INCOME":"EXPENSE"} data={data} onChange={onChange} onCreated={category=>{setCategoryId(category.id);setCreatingCategory(false)}} onCancel={()=>setCreatingCategory(false)}/>}
   
   </div><p className="form-note">Ao criar uma recorrência, o sistema gera os próximos 12 meses de lançamentos. Novos lançamentos não são duplicados ao usar “Gerar próximos”.</p>
   <div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar regra":"Criar recorrência"}</button>{(editing||embedded)&&<button className="secondary" onClick={embedded&&!editing?onCancel:reset}>Cancelar</button>}</div></section>
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
   <section className="metric-grid"><article className="metric"><span>Dinheiro livre</span><strong>{money(free)}</strong><small>Saldo real menos reservas ativas.</small></article><article className="metric"><span>Total reservado</span><strong>{money(reserved)}</strong><small>Valor separado nas caixinhas.</small></article></section>
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
 const maxCategory=Math.max(0,...cats.map(x=>x.amountCents));
 const maxIncome=Math.max(0,...income.map(x=>x.amountCents));
 const maxPerson=Math.max(0,...people.map(x=>x.amountCents));
 const maxMonth=Math.max(0,...months.map(x=>x.amountCents));
 const categoryMap=new Map(data.categories.map(c=>[c.id,c.emoji||"🏷️"]));
 const topCategory=cats[0];
 return <div className="page-content">
  <div className="page-heading"><div><span className="eyebrow">Análise</span><h1>Relatórios</h1></div><div className="report-controls"><div className="segmented-control" role="group" aria-label="Modo do relatório"><button className={mode==="REALIZED"?"active":""} onClick={()=>setMode("REALIZED")}>Realizado</button><button className={mode==="PROJECTED"?"active":""} onClick={()=>setMode("PROJECTED")}>Projetado</button></div><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div></div>
  <section className="metric-grid"><article className="metric"><span>Receitas</span><strong>{money(flow.incomeCents)}</strong></article><article className="metric"><span>Despesas</span><strong>{money(flow.expenseCents)}</strong>{topCategory&&<small>Maior categoria: {categoryMap.get(topCategory.categoryId)||"🏷️"} {topCategory.name}</small>}</article><article className="metric"><span>Pagamentos de cartão</span><strong>{money(flow.cardPaymentsCents)}</strong><small>Saída de caixa, sem duplicar despesa</small></article><article className="metric"><span>Resultado de caixa</span><strong>{money(flow.netCents)}</strong></article></section>
  <section className="panel report-section"><div className="report-section-heading"><div><h2>Despesas por categoria</h2><span>Onde o dinheiro foi gasto no período.</span></div></div>{cats.length===0?<Empty text="Nenhuma despesa categorizada neste mês."/>:<div className="report-list">{cats.map(x=>{const width=maxCategory?Math.max(4,(x.amountCents/maxCategory)*100):0;return <div className="report-bar-row" key={x.categoryId}><div className="report-row"><span>{categoryMap.get(x.categoryId)||"🏷️"} {x.name}</span><strong>{money(x.amountCents)}</strong></div><div className="report-bar-track"><div className="report-bar-fill" style={{width:`${width}%`}}/></div></div>})}</div>}</section>
  <section className="panel report-section"><h2>Receitas por categoria</h2>{income.length===0?<Empty text="Nenhuma receita categorizada neste mês."/>:<div className="report-list">{income.map(x=>{const width=maxIncome?Math.max(4,(x.amountCents/maxIncome)*100):0;return <div className="report-bar-row" key={x.categoryId}><div className="report-row"><span>{categoryMap.get(x.categoryId)||"🏷️"} {x.name}</span><strong>{money(x.amountCents)}</strong></div><div className="report-bar-track"><div className="report-bar-fill income" style={{width:`${width}%`}}/></div></div>})}</div>}</section>
  <section className="panel report-section"><h2>Despesas por pessoa</h2>{people.length===0?<Empty text="Nenhuma despesa vinculada a pessoa neste mês."/>:<div className="report-list">{people.map(x=>{const width=maxPerson?Math.max(4,(x.amountCents/maxPerson)*100):0;return <div className="report-bar-row" key={x.personId}><div className="report-row"><span>{x.name}</span><strong>{money(x.amountCents)}</strong></div><div className="report-bar-track"><div className="report-bar-fill person" style={{width:`${width}%`}}/></div></div>})}</div>}</section>
  <section className="panel report-section"><div className="report-section-heading"><div><h2>Evolução mensal de despesas</h2><span>Últimos seis períodos disponíveis.</span></div></div>{months.length===0?<Empty text="Ainda não há histórico de despesas."/>:<div className="report-list">{months.map(x=>{const width=maxMonth?Math.max(4,(x.amountCents/maxMonth)*100):0;return <div className="report-bar-row" key={x.month}><div className="report-row"><span>{x.month}</span><strong>{money(x.amountCents)}</strong></div><div className="report-bar-track"><div className="report-bar-fill monthly" style={{width:`${width}%`}}/></div></div>})}</div>}</section>
 </div>;
}

function Settings({data,family,onChange,onSignOut,syncStatus}:{data:EntityCollection;family:Family;onChange:(next:EntityCollection)=>Promise<void>;onSignOut:()=>Promise<void>;syncStatus:"syncing"|"synced"|"conflict"|"error"}) {
 const [error,setError]=useState(""); const [busy,setBusy]=useState(false); const [resetOpen,setResetOpen]=useState(false); const [resetPhrase,setResetPhrase]=useState("");
 async function importFile(file:File){
  setError("");setBusy(true);
  try{
   const next=importJson(await file.text());
   if(!confirm("Importar este backup substituirá os dados locais atuais. Deseja continuar?"))return;
   await onChange(next); alert("Backup importado com sucesso.");
  }catch(e){setError(e instanceof Error?e.message:"Backup inválido.");}
  finally{setBusy(false);}
 }
 async function resetFinancialData(){
  if(syncStatus!=="synced"){setError("Aguarde a sincronização concluir antes de zerar os dados da família.");return;}
  if(resetPhrase!=="ZERAR DADOS"){setError("Digite exatamente ZERAR DADOS para confirmar.");return;}
  if(!confirm("ATENÇÃO: este comando zera os DADOS FINANCEIROS DA FAMÍLIA e será sincronizado com todos os aparelhos. Contas, cartões, lançamentos, parcelas, recorrências, caixinhas, orçamentos e pessoas serão apagados. Categorias, família e login serão preservados. Faça um backup antes de continuar. Deseja realmente apagar os dados da família?"))return;
  setError("");setBusy(true);
  try{
   const next:EntityCollection={...data,people:[],accounts:[],cards:[],transactions:[],installmentGroups:[],recurringRules:[],pots:[],potMovements:[],budgets:[]};
   await onChange(next);
   setResetPhrase("");setResetOpen(false);
   alert("Dados financeiros zerados com segurança. A estrutura da família e as categorias foram preservadas.");
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível zerar os dados financeiros.");}
  finally{setBusy(false);}
 }

 return <div className="page-content"><div className="page-heading"><div><span className="eyebrow">Aplicativo</span><h1>Configurações</h1></div></div>
 {error&&<div className="global-alert">{error}</div>}
 <section className="panel"><h2>Família</h2><p>Compartilhe este código com outro membro para que ele possa entrar nesta família.</p><div className="family-invite-code"><strong>{family.invite_code}</strong><button className="secondary compact" onClick={async()=>{try{if(!navigator.clipboard)throw new Error("clipboard_unavailable");await navigator.clipboard.writeText(family.invite_code);alert("Código de convite copiado.");}catch{setError(`Não foi possível copiar automaticamente. Código: ${family.invite_code}`);}}}>Copiar código</button></div></section>
 <section className="panel settings-list">
   <div><strong>Aparência</strong><p>Alterne entre tema claro e escuro pelo botão ao lado do ícone de privacidade na tela inicial. A preferência fica salva neste aparelho.</p></div>
  <div><strong>Backup completo</strong><p>Exporta todas as entidades financeiras em JSON.</p><button className="primary compact" onClick={()=>exportJson(data)}>Exportar JSON</button></div>
  <div className="danger-zone"><strong>Zerar dados financeiros</strong><p>Apaga os dados financeiros <b>da família inteira</b> e sincroniza a limpeza com os outros aparelhos. Faça um backup antes. O reset fica bloqueado enquanto houver sincronização pendente ou conflito.</p><button className="secondary compact danger-button" onClick={()=>{setResetOpen(true);setResetPhrase("");setError("")}} disabled={busy||syncStatus!=="synced"}>Abrir reset seguro</button>{resetOpen&&<div className="reset-confirm"><strong>Confirmação obrigatória</strong><p>Este é um reset compartilhado. Antes de continuar, confirme que você exportou um backup e que não precisa dos dados atuais.</p><p>Digite <b>ZERAR DADOS</b> para habilitar a exclusão.</p><input value={resetPhrase} onChange={e=>setResetPhrase(e.target.value.toUpperCase())} placeholder="ZERAR DADOS" autoCapitalize="characters"/><div className="form-actions"><button className="secondary compact" onClick={()=>{setResetOpen(false);setResetPhrase("")}}>Cancelar</button><button className="primary compact" disabled={busy||resetPhrase!=="ZERAR DADOS"} onClick={()=>void resetFinancialData()}>Zerar dados financeiros</button></div></div>}</div>
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
 function update<K extends keyof SmartDraft>(key:K,value:SmartDraft[K]){setDraft(d=>{if(!d)return d;const next={...d,[key]:value};if(key==="date"){next.warnings=d.warnings.filter(w=>w!=="Não identifiquei a data. Confirme se é hoje ou escolha outra data antes de salvar.");}return next;})}
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
   <p className="muted">Aponte a câmera para o recibo, tente deixar o papel inteiro visível e evite sombras. A leitura é feita no dispositivo e o resultado fica apenas como rascunho até sua confirmação.</p>
   <label className="file-capture"><span>📷 Tirar foto do recibo</span><input type="file" accept="image/jpeg,image/png,image/webp,image/*" capture="environment" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void scan(file)}}/></label>
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
 const [editing,setEditing]=useState<Category|null>(null); const [name,setName]=useState(""); const [emoji,setEmoji]=useState("🏷️"); const [kind,setKind]=useState<Category["kind"]>("EXPENSE"); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 function reset(){setEditing(null);setName("");setEmoji("🏷️");setKind("EXPENSE");setError("")}
 function edit(c:Category){setEditing(c);setName(c.name);setEmoji(c.emoji??"🏷️");setKind(c.kind);setError("")}
 async function save(){setError("");try{const c=editing?updateCategory(editing,name,kind,data,emoji):createCategory(name,kind,data,emoji);setBusy(true);await onChange({...data,categories:editing?data.categories.map(x=>x.id===c.id?c:x):[...data.categories,c]});reset();}catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar a categoria.");}finally{setBusy(false)}}
 async function archive(c:Category){if(!confirm("Arquivar esta categoria? O histórico dos lançamentos será preservado."))return;setBusy(true);setError("");try{await onChange({...data,categories:data.categories.map(x=>x.id===c.id?archiveCategory(x):x)});}catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar a categoria.");}finally{setBusy(false)}}
 const active=data.categories.filter(c=>c.active);
 return <div className="page-content">
  <div className="page-heading"><div><span className="eyebrow">Cadastros</span><h1>Categorias</h1></div><button className="primary compact" onClick={reset}>+ Nova categoria</button></div>
  {error&&<div className="global-alert">{error}</div>}
  <section className="panel">{active.length===0?<Empty text="Nenhuma categoria cadastrada."/>:<div className="report-list">{active.map(c=><div className="report-row" key={c.id}><span><strong>{c.emoji??"🏷️"} {c.name}</strong> · {c.kind==="EXPENSE"?"Despesa":"Receita"}</span><div className="row-actions"><button className="link-button" onClick={()=>edit(c)}>Editar</button><button className="link-button danger" disabled={busy} onClick={()=>void archive(c)}>Arquivar</button></div></div>)}</div>}</section>
  <section className="panel form-panel"><h2>{editing?"Editar categoria":"Nova categoria"}</h2><div className="form-grid"><label>Nome<input value={name} maxLength={60} onChange={e=>setName(e.target.value)} placeholder="Ex.: Alimentação"/></label><label>Emoji<input value={emoji} maxLength={8} onChange={e=>setEmoji(e.target.value)} aria-label="Emoji da categoria"/></label><label>Tipo<select value={kind} onChange={e=>setKind(e.target.value as Category["kind"])}><option value="EXPENSE">Despesa</option><option value="INCOME">Receita</option></select></label></div><div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar alterações":"Adicionar categoria"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar</button>}</div><p className="form-note">Arquivar remove a categoria dos novos lançamentos, mas preserva os lançamentos históricos e seus relatórios.</p></section>
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

function More({data,family,onChange,onSignOut,defaultSection="smart",syncStatus}:{data:EntityCollection;family:Family;onChange:(next:EntityCollection)=>Promise<void>;onSignOut:()=>Promise<void>;defaultSection?:"menu"|"smart"|"receipt"|"pots"|"recurring"|"budgets"|"assistant"|"people"|"categories"|"settings";syncStatus:"syncing"|"synced"|"conflict"|"error"}) {
 const [section,setSection]=useState<"menu"|"smart"|"receipt"|"pots"|"recurring"|"budgets"|"assistant"|"people"|"categories"|"settings">(defaultSection);
 const tools=[{id:"smart",label:"Entrada inteligente",description:"Registrar por texto ou voz",icon:"sparkles"},{id:"receipt",label:"Ler recibo",description:"Capturar dados de uma nota",icon:"scan"},{id:"pots",label:"Caixinhas",description:"Separar dinheiro por objetivo",icon:"target"},{id:"recurring",label:"Recorrências",description:"Organizar pagamentos repetidos",icon:"repeat"},{id:"budgets",label:"Orçamentos",description:"Definir limites por categoria",icon:"chart"},{id:"assistant",label:"Assistente",description:"Consultar a saúde financeira",icon:"brain"},{id:"people",label:"Pessoas",description:"Organizar membros da família",icon:"users"},{id:"categories",label:"Categorias",description:"Classificar entradas e gastos",icon:"shapes"},{id:"settings",label:"Configurações",description:"Backup, convite e segurança",icon:"settings"}] as const;
 const content=section==="smart"?<SmartInput data={data} onChange={onChange}/>:section==="receipt"?<ReceiptScanner data={data} onChange={onChange}/>:section==="pots"?<Pots data={data} onChange={onChange}/>:section==="recurring"?<Recurring data={data} onChange={onChange}/>:section==="budgets"?<Budgets data={data} onChange={onChange}/>:section==="assistant"?<Assistant data={data}/>:section==="people"?<People data={data} onChange={onChange}/>:section==="categories"?<Categories data={data} onChange={onChange}/>:<Settings data={data} family={family} onChange={onChange} onSignOut={onSignOut} syncStatus={syncStatus}/>;
 const selectedTool=tools.find(item=>item.id===section);
 if(section==="menu")return <div className="page-content more-page"><div className="more-heading"><div><span className="eyebrow">Ferramentas e organização</span><h1>Mais ferramentas</h1><p className="more-intro">Escolha uma área para abrir em tela inteira.</p></div></div><div className="more-menu-grid" aria-label="Ferramentas do aplicativo">{tools.map(item=><button key={item.id} className="more-menu-card" onClick={()=>setSection(item.id)}><span className={`more-menu-icon tool-icon-${item.icon}`} aria-hidden="true"><ToolIcon name={item.icon}/></span><span className="more-menu-copy"><strong>{item.label}</strong><small>{item.description}</small></span><span className="more-menu-arrow" aria-hidden="true"><ToolIcon name="chevron"/></span></button>)}</div></div>;
 return <div className="page-content more-page more-detail-page"><div className="more-detail-top"><button className="more-back-button" type="button" onClick={()=>setSection("menu")}><ToolIcon name="back"/> <span>Mais ferramentas</span></button><div className="more-detail-title"><span className={`more-menu-icon tool-icon-${selectedTool?.icon}`} aria-hidden="true"><ToolIcon name={selectedTool?.icon??"settings"}/></span><div><span className="eyebrow">Ferramentas e organização</span><h1>{selectedTool?.label}</h1><p className="more-intro">{selectedTool?.description}</p></div></div></div><div className="more-detail-content">{content}</div></div>;
}

function Cards({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
 const [editing,setEditing]=useState<CreditCard|null>(null),[name,setName]=useState(""),[accountId,setAccountId]=useState(""),[limit,setLimit]=useState(""),[closingDay,setClosingDay]=useState("10"),[dueDay,setDueDay]=useState("20"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[expandedCardId,setExpandedCardId]=useState<string|null>(null),[selectedInvoiceByCard,setSelectedInvoiceByCard]=useState<Record<string,string>>({});
 const accounts=data.accounts;
 function reset(){setEditing(null);setName("");setAccountId("");setLimit("");setClosingDay("10");setDueDay("20");setError("")}
 function edit(c:CreditCard){setEditing(c);setName(c.name);setAccountId(c.accountId);setLimit((c.creditLimitCents/100).toFixed(2).replace(".",","));setClosingDay(String(c.closingDay));setDueDay(String(c.dueDay));setError("")}
 async function save(){setError("");try{const cents=parseAmount(limit),close=Number(closingDay),due=Number(dueDay);if(!name.trim()||!accountId||!Number.isInteger(close)||close<1||close>31||!Number.isInteger(due)||due<1||due>31)throw new Error("Preencha nome, conta e dias válidos.");const card:CreditCard={id:editing?.id??crypto.randomUUID(),name:name.trim(),accountId,creditLimitCents:cents,closingDay:close,dueDay:due,active:true};if(editing){validateCreditCardUpdate(editing,card,data.accounts.map(a=>a.id),data.transactions)}else{validateCreditCard(card,data.accounts.filter(a=>a.active).map(a=>a.id))}const next={...data,cards:editing?data.cards.map(c=>c.id===card.id?card:c):[...data.cards,card]};setBusy(true);await onChange(next);reset()}catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar o cartão.")}finally{setBusy(false)}}
 async function archive(c:CreditCard){if(!confirm("Arquivar este cartão? O histórico será preservado."))return;try{validateCreditCardArchive(c,data.recurringRules)}catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar.");return;}setBusy(true);setError("");try{await onChange({...data,cards:data.cards.map(x=>x.id===c.id?{...x,active:false}:x)})}catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar.")}finally{setBusy(false)}}
 async function reactivate(c:CreditCard){
   const account=data.accounts.find(a=>a.id===c.accountId);
   if(!account?.active){setError("A conta vinculada ao cartão está arquivada. Reative a conta antes de reativar o cartão.");return;}
   try{validateCreditCard(c,data.accounts.filter(a=>a.active).map(a=>a.id));}catch(e){setError(e instanceof Error?e.message:"Não foi possível reativar o cartão.");return;}
   setBusy(true);setError("");
   try{await onChange({...data,cards:data.cards.map(x=>x.id===c.id?{...x,active:true}:x)});}
   catch(e){setError(e instanceof Error?e.message:"Não foi possível reativar o cartão.");}
   finally{setBusy(false)}
 }
 async function payInvoice(c:CreditCard){
   const invoice=getCardInvoice(c,data.transactions,todayFinancialDate());
   if(invoice.openAmountCents<=0){setError("Não há valor em aberto na fatura atual.");return}
   const tx:Transaction={id:crypto.randomUUID(),date:todayFinancialDate(),type:"CARD_PAYMENT",status:"PAID",amountCents:invoice.openAmountCents,description:`Pagamento da fatura — ${c.name}`,accountId:c.accountId,creditCardId:c.id};
   try{validateTransaction(tx,{accounts:data.accounts,cards:data.cards,transactions:data.transactions});setBusy(true);setError("");await onChange({...data,transactions:[...data.transactions,tx]})}catch(e){setError(e instanceof Error?e.message:"Não foi possível pagar a fatura.")}finally{setBusy(false)}
 }
 function invoiceRows(c:CreditCard){
   const today=todayFinancialDate();
   const currentClosing=invoiceClosingDate(today,c.closingDay);
   const rows=new Map<string,{closingDate:string;dueDate:string;amountCents:number;transactions:Transaction[]}>();
   const allocations=allocateCardPayments(c,data.transactions);
   const allocatedByClosing=new Map<string,number>();
   for(const allocation of allocations) allocatedByClosing.set(allocation.closingDate,(allocatedByClosing.get(allocation.closingDate)??0)+allocation.amountCents);
   for(const tx of data.transactions){
     if(tx.status!=="PAID"||tx.creditCardId!==c.id||tx.type!=="EXPENSE")continue;
     const closing=invoiceClosingDate(tx.date,c.closingDay);
     if(closing<currentClosing)continue;
     const due=invoiceDueDateFromClosing(closing,c.closingDay,c.dueDay);
     const row=rows.get(closing)??{closingDate:closing,dueDate:due,amountCents:0,transactions:[]};
     row.amountCents+=tx.amountCents;
     row.transactions.push(tx);
     rows.set(closing,row);
   }
   for(const row of rows.values()){
     row.amountCents=Math.max(0,row.amountCents-(allocatedByClosing.get(row.closingDate)??0));
     row.transactions.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
   }
   const sorted=[...rows.values()].sort((a,b)=>a.closingDate.localeCompare(b.closingDate));
   const currentIndex=sorted.findIndex(row=>row.closingDate===currentClosing);
   const result=sorted.slice(Math.max(0,currentIndex));
   const known=new Set(result.map(row=>row.closingDate));
   const current=new Date(currentClosing+"T12:00:00");
   for(let i=0;result.length<12;i++){
     const d=new Date(current.getFullYear(),current.getMonth()+i,1);
     const closing=invoiceClosingDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(Math.min(d.getDate(),28)).padStart(2,"0")}`,c.closingDay);
     if(known.has(closing))continue;
     result.push({closingDate:closing,dueDate:invoiceDueDateFromClosing(closing,c.closingDay,c.dueDay),amountCents:0,transactions:[]});
     known.add(closing);
   }
   return result.slice(0,12).sort((a,b)=>a.closingDate.localeCompare(b.closingDate));
 }
 function invoiceLabel(closingDate:string,index:number){
   const d=new Date(closingDate+"T12:00:00");
   const label=d.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
   return index===0 ? `Fatura atual · ${label}` : label.charAt(0).toUpperCase()+label.slice(1);
 }
 function selectInvoice(c:CreditCard,rows:ReturnType<typeof invoiceRows>){
   return selectedInvoiceByCard[c.id]&&rows.some(row=>row.closingDate===selectedInvoiceByCard[c.id]) ? selectedInvoiceByCard[c.id] : rows[0]?.closingDate;
 }
 return <div className="page-content"><div className="page-heading"><div><span className="eyebrow">Crédito</span><h1>Cartões</h1></div><button className="primary compact" onClick={reset}>+ Novo cartão</button></div>{error&&<div className="global-alert">{error}</div>}
 <section className="card-grid">{data.cards.filter(c=>c.active).length===0?<section className="panel"><Empty text="Nenhum cartão cadastrado."/></section>:data.cards.filter(c=>c.active).map(c=>{const available=calculateCardAvailableLimit(c,data.transactions),outstanding=calculateCardOutstanding(c,data.transactions),credit=calculateCardCreditBalance(c,data.transactions),inv=getCardInvoice(c,data.transactions,todayFinancialDate()),rows=invoiceRows(c),selectedClosing=selectInvoice(c,rows),selected=rows.find(row=>row.closingDate===selectedClosing)??rows[0],expanded=expandedCardId===c.id;return <article className="panel card-item" key={c.id}><div className="card-item-head"><div><strong>{c.name}</strong><span>Fecha dia {c.closingDay} · vence dia {c.dueDay}</span></div><strong>{money(available)}</strong></div><div className="card-metrics"><div><span>Limite</span><strong>{money(c.creditLimitCents)}</strong></div><div><span>Em aberto</span><strong>{money(outstanding)}</strong></div><div><span>Fatura atual</span><strong>{money(inv.openAmountCents)}</strong></div><div><span>Crédito a favor</span><strong>{money(credit)}</strong></div></div><small>Fechamento: {inv.closingDate} · Vencimento: {inv.dueDate}</small><div className="row-actions card-actions"><button className="primary compact" disabled={busy||inv.openAmountCents<=0} onClick={()=>void payInvoice(c)}>Pagar fatura</button><button className="secondary compact" onClick={()=>setExpandedCardId(expanded?null:c.id)}>{expanded?"Ocultar faturas":"Ver faturas"}</button><button className="link-button" onClick={()=>edit(c)}>Editar</button><button className="link-button danger" disabled={busy} onClick={()=>void archive(c)}>Arquivar</button></div>{expanded&&<section className="panel form-panel"><div className="section-title"><div><h2>Consultar fatura por mês</h2><span>Veja quanto está comprometido e quais lançamentos formam cada mês.</span></div></div><label>Mês da fatura<select value={selectedClosing??""} onChange={e=>setSelectedInvoiceByCard(prev=>({...prev,[c.id]:e.target.value}))}>{rows.map((row,index)=><option key={row.closingDate} value={row.closingDate}>{invoiceLabel(row.closingDate,index)} — {money(row.amountCents)}</option>)}</select></label>{selected&&<><div className="hero-card"><span>Total a pagar neste mês</span><strong>{money(selected.amountCents)}</strong><small>Fecha {new Date(selected.closingDate+"T12:00:00").toLocaleDateString("pt-BR")} · vence {new Date(selected.dueDate+"T12:00:00").toLocaleDateString("pt-BR")}</small></div><div className="section-title"><h3>Lançamentos</h3><span>{selected.transactions.length} lançamento(s)</span></div>{selected.transactions.length===0?<Empty text="Nenhum lançamento previsto para este mês."/>:<div className="account-list">{selected.transactions.map(tx=><div className="account-row" key={tx.id}><div><strong>{tx.description||"Compra no cartão"}</strong><span>{new Date(tx.date+"T12:00:00").toLocaleDateString("pt-BR")}{tx.installmentGroupId? ` · Parcela ${getInstallmentNumber(data.installmentGroups.find(group=>group.id===tx.installmentGroupId)!,tx.id)}`:""}</span></div><strong>{money(tx.amountCents)}</strong></div>)}</div>}<p className="form-note">O total considera pagamentos já alocados. Parcelas futuras já lançadas aparecem no mês correspondente; compras ainda não lançadas não aparecem.</p></>}</section>}</article>})}</section>
 <section className="panel archived-panel"><div className="section-title"><div><h2>Cartões arquivados</h2><span>O histórico e as faturas anteriores permanecem preservados.</span></div></div><div className="card-grid">{data.cards.filter(c=>!c.active).map(c=>{const account=data.accounts.find(a=>a.id===c.accountId);return <article className="panel card-item" key={c.id}><div className="card-item-head"><div><strong>{c.name}</strong><span>Conta de pagamento: {account?.name??"Conta não encontrada"}{account?.active?"":" · conta arquivada"}</span></div><span>Limite {money(c.creditLimitCents)}</span></div><div className="row-actions card-actions"><button className="secondary compact" disabled={busy} onClick={()=>void reactivate(c)}>Reativar</button></div></article>})}</div></section>
 <section className="panel form-panel"><h2>{editing?"Editar cartão":"Novo cartão"}</h2><div className="form-grid"><label>Nome<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Visa principal"/></label><label>Conta para pagamento<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Selecione</option>{accounts.filter(a=>a.active||a.id===editing?.accountId).map(a=><option key={a.id} value={a.id}>{a.name}{a.active?"":" (arquivada)"}</option>)}</select></label><label>Limite<input inputMode="decimal" value={limit} onChange={e=>setLimit(e.target.value)} placeholder="0,00"/></label><label>Dia de fechamento<input type="number" min="1" max="31" value={closingDay} onChange={e=>setClosingDay(e.target.value)}/></label><label>Dia de vencimento<input type="number" min="1" max="31" value={dueDay} onChange={e=>setDueDay(e.target.value)}/></label></div><div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar alterações":"Criar cartão"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar</button>}</div><p className="form-note">O limite disponível é derivado das compras e pagamentos registrados. O pagamento da fatura sai da conta vinculada.</p></section></div>
}

function ToolIcon({name}:{name:string}){const common={fill:"none",stroke:"currentColor",strokeWidth:1.8,strokeLinecap:"round" as const,strokeLinejoin:"round" as const};return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>{name==="sparkles"?<><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z"/></>:name==="scan"?<><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10M12 7v10"/></>:name==="target"?<><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></>:name==="repeat"?<><path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></>:name==="chart"?<><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 15v2M12 10v7M17 7v10"/></>:name==="brain"?<><path d="M12 5a4 4 0 0 0-7 2.5A4.5 4.5 0 0 0 6 16a4 4 0 0 0 6 3.5V5Z"/><path d="M12 5a4 4 0 0 1 7 2.5A4.5 4.5 0 0 1 18 16a4 4 0 0 1-6 3.5M8 9c2 0 2 2 4 2M16 9c-2 0-2 2-4 2M8 15c2 0 2-1 4-1M16 15c-2 0-2-1-4-1"/></>:name==="users"?<><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M16 5.5a3 3 0 0 1 0 5.8M18 15a4.5 4.5 0 0 1 2.5 4"/></>:name==="shapes"?<><rect x="3" y="3" width="7" height="7" rx="2"/><circle cx="17" cy="6.5" r="3.5"/><path d="m6.5 14 4 7h-8l4-7ZM17 13v8M13 17h8"/></>:name==="settings"?<><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.1 1.8-1.8 3.1-2.1-.5a7.6 7.6 0 0 1-1.7 1l-.4 2h-3.6l-.4-2a7.6 7.6 0 0 1-1.7-1l-2.1.5-1.8-3.1 1.1-1.8a7.8 7.8 0 0 1 0-2L5 11.2l1.8-3.1 2.1.5a7.6 7.6 0 0 1 1.7-1l.4-2h3.6l.4 2a7.6 7.6 0 0 1 1.7 1l2.1-.5 1.8 3.1-1.1 1.8a7.8 7.8 0 0 1 0 2Z" transform="translate(-1 -1) scale(1.08)"/></>:name==="back"?<><path d="m15 18-6-6 6-6"/><path d="M9 12h11"/></>:name==="chevron"?<path d="m9 18 6-6-6-6"/>:<circle cx="12" cy="12" r="8"/>}</svg>}

function NavIcon({name}:{name:"home"|"wallet"|"arrows"|"card"|"chart"|"more"}){return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">{name==="home"?<><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></>:name==="wallet"?<><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18"/><path d="M16 14h2"/></>:name==="arrows"?<><path d="M4 7h15l-3-3"/><path d="m19 7-3 3"/><path d="M20 17H5l3 3"/><path d="m5 17 3-3"/></>:name==="card"?<><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M3 10h18"/><path d="M6 15h4"/></>:name==="chart"?<><path d="M3 3v18h18"/><path d="m7 14 4-4 3 2 5-6"/></>:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>}</svg>}

function AppShell({user,family,onSignOut,onSwitchFamily}:{user:User;family:Family;onSignOut:()=>Promise<void>;onSwitchFamily:()=>void}) {
  const [page,setPage]=useState<Page>("dashboard");
  const [hideValues,setHideValues]=useState(()=>localStorage.getItem("finance-hide-values")==="1");
  function toggleHideValues(){setHideValues(current=>{const next=!current;localStorage.setItem("finance-hide-values",next?"1":"0");return next;});}
  const [theme,setTheme]=useState<"light"|"dark">(()=>localStorage.getItem("finance-theme")==="dark"?"dark":"light");
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem("finance-theme",theme);},[theme]);
  function changeTheme(next:"light"|"dark"){setTheme(next);}
  const [quickMode,setQuickMode]=useState<"menu"|"smart"|"receipt">("menu");
  function openQuickAction(mode:"smart"|"receipt"|"manual"){
    if(mode==="manual"){setPage("transacoes");return}
    setQuickMode(mode);setPage("mais")
  }
  const [data,setData]=useState<EntityCollection>(emptyData);
  const [loading,setLoading]=useState(true);
  const [syncStatus,setSyncStatus]=useState<"syncing"|"synced"|"conflict"|"error">("syncing");
  const [error,setError]=useState("");
  const [conflict,setConflict]=useState<{local:EntityCollection;remote:EntityCollection;remoteVersion:number}|null>(null);
  const [remoteVersion,setRemoteVersion]=useState(0);
  const [legacyData,setLegacyData]=useState<EntityCollection|null>(null);
  const [legacyMigrationDismissed,setLegacyMigrationDismissed]=useState(false);
  const repo = useMemo(() => new IndexedDbFinanceRepository(family.id), [family.id]);
  useEffect(()=>{
    setLoading(true);
    setError("");
    setSyncStatus("syncing");
    setConflict(null);
    setRemoteVersion(0);
    setLegacyData(null);
    setLegacyMigrationDismissed(localStorage.getItem(`legacy-migration-dismissed-${family.id}`) === "1");
    let cancelled=false;
    (async()=>{
      try {
        if (!localStorage.getItem(`legacy-migration-completed-${family.id}`) && !localStorage.getItem(`legacy-migration-dismissed-${family.id}`) && await hasLegacyDatabase()) {
          try { const oldData = await readLegacyLocalData(); if (!cancelled) setLegacyData(oldData); } catch {}
        }
        const rawLocal:EntityCollection={people:await repo.list("people"),categories:await repo.list("categories"),accounts:await repo.list("accounts"),cards:await repo.list("cards"),transactions:await repo.list("transactions"),installmentGroups:await repo.list("installmentGroups"),recurringRules:await repo.list("recurringRules"),pots:await repo.list("pots"),potMovements:await repo.list("potMovements"),budgets:await repo.list("budgets")};
        const local:EntityCollection={...rawLocal,categories:normalizeCategoryEmojis(rawLocal.categories)};
        const syncMeta=await repo.getSyncMetadata();
        if(JSON.stringify(local.categories)!==JSON.stringify(rawLocal.categories)){await repo.replaceAll(local);}
        if(!cancelled)setData(local);

        const remote=await pullFinanceState(family.id);
        if(cancelled)return;

        if(syncMeta.dirty){
          if(remote && remote.version!==syncMeta.remoteVersion){
            const normalizedRemote={...remote.state,categories:normalizeCategoryEmojis(remote.state.categories)};
            setConflict({local,remote:normalizedRemote,remoteVersion:remote.version});
            setRemoteVersion(remote.version);
            setSyncStatus("conflict");
          }else{
            const expectedVersion=remote?.version ?? 0;
            const result=await pushFromLocalFirst(family.id,local,expectedVersion);
            if(result.kind==="pushed"){
              await repo.setSyncMetadata({remoteVersion:result.version,dirty:false});
              setRemoteVersion(result.version);
              setSyncStatus("synced");
            }else{
              const latest=await pullFinanceState(family.id);
              if(latest){
                const normalizedLatest={...latest.state,categories:normalizeCategoryEmojis(latest.state.categories)};
                setConflict({local,remote:normalizedLatest,remoteVersion:latest.version});
                setRemoteVersion(latest.version);
                setSyncStatus("conflict");
              }else{
                throw new Error("Não foi possível confirmar o estado online após o conflito.");
              }
            }
          }
        }else if(remote){
          const normalizedRemote={...remote.state,categories:normalizeCategoryEmojis(remote.state.categories)};
          await repo.replaceAll(normalizedRemote);
          await repo.setSyncMetadata({remoteVersion:remote.version,dirty:false});
          setData(normalizedRemote);
          setRemoteVersion(remote.version);
          setSyncStatus("synced");
        }else if(family.created_by===user.id){
          const result=await pushFromLocalFirst(family.id,local,0);
          if(result.kind==="pushed"){
            await repo.setSyncMetadata({remoteVersion:result.version,dirty:false});
            setRemoteVersion(result.version);
            setSyncStatus("synced");
          }else{
            throw new Error("Não foi possível inicializar os dados online da família.");
          }
        }else{
          throw new Error("A família ainda não possui dados online. Aguarde o aparelho que criou a família concluir a sincronização e tente novamente.");
        }
      } catch(e){ if(!cancelled){setError(e instanceof Error?e.message:"Falha ao carregar dados.");setSyncStatus("error");} }
      finally{if(!cancelled)setLoading(false);}
    })();
    return ()=>{cancelled=true};
  },[family.id]);
  async function persist(next:EntityCollection){
    setError("");
    setSyncStatus("syncing");
    try{
      await repo.replaceAll(next);
      await repo.setSyncMetadata({remoteVersion,dirty:true});
      setData(next);
      const result=await pushFromLocalFirst(family.id,next,remoteVersion);
      if(result.kind==="pushed"){
        await repo.setSyncMetadata({remoteVersion:result.version,dirty:false});
        setRemoteVersion(result.version);
        setConflict(null);
        setSyncStatus("synced");
        return;
      }
      const remote=await pullFinanceState(family.id);
      if(remote){
        const normalized={...remote.state,categories:normalizeCategoryEmojis(remote.state.categories)};
        setConflict({local:next,remote:normalized,remoteVersion:remote.version});
        setRemoteVersion(remote.version);
        setSyncStatus("conflict");
      }
      throw new Error("Conflito de sincronização: outro aparelho alterou os dados online. Escolha abaixo qual estado deve prevalecer.");
    }catch(error){
      if(error instanceof Error && error.message.startsWith("Conflito de sincronização:")) throw error;
      setSyncStatus("error");
      setError(error instanceof Error?error.message:"Não foi possível salvar e sincronizar os dados.");
      throw error;
    }
  }
  async function keepRemote(){
    if(!conflict)return;
    setError("");
    setSyncStatus("syncing");
    try{
      const latest=await pullFinanceState(family.id);
      if(!latest) throw new Error("O estado online não está mais disponível. Atualize e tente novamente.");
      if(latest.version!==conflict.remoteVersion){
        const normalized={...latest.state,categories:normalizeCategoryEmojis(latest.state.categories)};
        setConflict({local:conflict.local,remote:normalized,remoteVersion:latest.version});
        setRemoteVersion(latest.version);
        setSyncStatus("conflict");
        return;
      }
      const normalized={...latest.state,categories:normalizeCategoryEmojis(latest.state.categories)};
      await repo.replaceAll(normalized);
      await repo.setSyncMetadata({remoteVersion:latest.version,dirty:false});
      setData(normalized);
      setRemoteVersion(latest.version);
      setConflict(null);
      setSyncStatus("synced");
    }catch(error){
      setSyncStatus("error");
      setError(error instanceof Error?error.message:"Não foi possível usar os dados online.");
    }
  }
  async function keepLocal(){
    if(!conflict)return;
    setError("");
    setSyncStatus("syncing");
    try{
      const latest=await pullFinanceState(family.id);
      if(!latest) throw new Error("O estado online não está mais disponível. Atualize e tente novamente.");
      if(latest.version!==conflict.remoteVersion){
        const normalized={...latest.state,categories:normalizeCategoryEmojis(latest.state.categories)};
        setConflict({local:conflict.local,remote:normalized,remoteVersion:latest.version});
        setRemoteVersion(latest.version);
        setSyncStatus("conflict");
        return;
      }
      await repo.setSyncMetadata({remoteVersion:latest.version,dirty:true});
      const result=await pushFromLocalFirst(family.id,conflict.local,latest.version);
      if(result.kind==="pushed"){
        await repo.setSyncMetadata({remoteVersion:result.version,dirty:false});
        setRemoteVersion(result.version);
        setConflict(null);
        setSyncStatus("synced");
        setError("");
        return;
      }
      const refreshed=await pullFinanceState(family.id);
      if(refreshed){
        const normalized={...refreshed.state,categories:normalizeCategoryEmojis(refreshed.state.categories)};
        setConflict({local:conflict.local,remote:normalized,remoteVersion:refreshed.version});
        setRemoteVersion(refreshed.version);
        setSyncStatus("conflict");
      }
    }catch(error){
      setSyncStatus("error");
      setError(error instanceof Error?error.message:"Não foi possível manter os dados deste aparelho.");
    }
  }
  const content = page==="dashboard" ? <Dashboard data={data} onQuickAction={openQuickAction} hideValues={hideValues} onToggleHideValues={toggleHideValues} syncStatus={syncStatus} theme={theme} onThemeChange={changeTheme}/> :
    page==="contas" ? <Accounts data={data} onChange={persist}/> :
    page==="transacoes" ? <Transactions data={data} onChange={persist}/> :
    page==="cartoes" ? <Cards data={data} onChange={persist}/> :
    page==="mais" ? <More data={data} family={family} onChange={persist} onSignOut={onSignOut} defaultSection={quickMode} syncStatus={syncStatus}/> : page==="relatorios" ? <Reports data={data}/> :
    <Dashboard data={data} onQuickAction={openQuickAction} hideValues={hideValues} onToggleHideValues={toggleHideValues} syncStatus={syncStatus} theme={theme} onThemeChange={changeTheme}/>;
  return <div className="shell">
    <header className="topbar"><div><strong>Controle Familiar</strong><span>{family.name}</span></div><div className="topbar-actions"><button className="secondary compact" onClick={onSwitchFamily}>Trocar família</button><button className="icon-button" onClick={()=>void onSignOut()}>Sair</button></div></header>
    {legacyData && <section className="panel sync-conflict"><strong>Dados locais de uma versão anterior encontrados</strong><p>Encontramos dados salvos neste aparelho antes da separação por família. Eles não foram misturados automaticamente.</p><p>Se esta família já possui dados financeiros, não importe os dados antigos: a importação substitui o estado financeiro atual da família.</p><div className="form-actions"><button className="secondary compact" onClick={()=>{localStorage.setItem(`legacy-migration-dismissed-${family.id}`,"1");setLegacyData(null);}}>Ignorar</button><button className="primary compact" onClick={()=>{const old=legacyData;if(!old)return;const currentHasData=Object.values(data).some(items=>items.length>0);if(currentHasData){setError("A família atual já possui dados. Por segurança, os dados locais antigos não podem substituir esse estado automaticamente. Exporte um backup e faça a migração somente após confirmar que a família está vazia.");return;}void persist(old).then(()=>{localStorage.setItem(`legacy-migration-completed-${family.id}`,"1");setLegacyData(null)}).catch(e=>setError(e instanceof Error?e.message:"Não foi possível importar os dados antigos."));}}>Importar dados antigos</button></div></section>}
    {error && <div className="global-alert">{error}</div>}{conflict && <section className="panel sync-conflict"><strong>Conflito de sincronização</strong><p>Os dados deste aparelho e os dados online são diferentes. Não fazemos mesclagem automática de informações financeiras.</p><div className="form-actions"><button className="secondary compact" onClick={()=>void keepRemote()}>Usar dados online</button><button className="primary compact" onClick={()=>void keepLocal()}>Manter meus dados</button></div></section>}{loading ? <div className="loading">Carregando dados financeiros…</div> : content}
    <nav className="bottom-nav">{([["dashboard","Início","home","Início"],["contas","Contas","wallet","Contas"],["transacoes","Lanç.","arrows","Lançamentos"],["cartoes","Cartões","card","Cartões"],["relatorios","Relat.","chart","Relatórios"],["mais","Mais","more","Mais ferramentas"]] as const).map(([key,label,icon,accessibleLabel])=><button className={page===key?"active":""} key={key} onClick={()=>{if(key==="mais")setQuickMode("menu");setPage(key)}} aria-current={page===key?"page":undefined} aria-label={accessibleLabel}><NavIcon name={icon}/><small>{label}</small></button>)}</nav>
  </div>;
}

export default function App() {
  const [user,setUser]=useState<User|null>(null);
  const [family,setFamily]=useState<Family|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const authUserIdRef = useRef<string|null>(null);
  useEffect(()=>{
    let alive=true;
    getAuthState().then(s=>{if(alive){authUserIdRef.current=s.user?.id ?? null;setUser(s.user);setLoading(false)}}).catch(e=>{if(alive){setError(e instanceof Error?e.message:"Supabase não configurado.");setLoading(false)}});
    const subscription=onAuthStateChange(s=>{
      if(!alive)return;
      const nextUserId=s.user?.id ?? null;
      if(authUserIdRef.current !== nextUserId){
        authUserIdRef.current=nextUserId;
        setFamily(null);
      }
      setUser(s.user);
    });
    return ()=>{alive=false;subscription.data.subscription.unsubscribe()};
  },[]);
  if(loading)return <div className="loading full">Carregando…</div>;
  if(error && !user)return <main className="auth-page"><section className="panel"><h1>Configuração necessária</h1><div className="alert error">{error}</div><p className="muted">Defina as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no ambiente do aplicativo.</p></section></main>;
  if(!user)return <AuthScreen onAuthenticated={setUser}/>;
  if(!family)return <FamilyScreen user={user} onReady={setFamily}/>;
  return <AppShell user={user} family={family} onSwitchFamily={()=>setFamily(null)} onSignOut={async()=>{await signOut();setFamily(null);setUser(null)}}/>;
}
