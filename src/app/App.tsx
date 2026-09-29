import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { EntityCollection } from "../infrastructure/persistence/repository";
import { IndexedDbFinanceRepository } from "../infrastructure/persistence/indexeddb";
import { calculateProjectedAccountBalance, calculateTotalRealBalance, validateTransaction } from "../domain/transactions/financial-engine";
import { getAuthState, onAuthStateChange, signInWithEmail, signOut, signUpWithEmail } from "../infrastructure/supabase/auth";
import { createFamily, joinFamily, listMyFamilies, type Family } from "../infrastructure/supabase/family";
import { pullFinanceState } from "../infrastructure/supabase/sync";
import { pushFromLocalFirst } from "../infrastructure/supabase/sync-coordinator";
import type { Account, AccountType, Transaction, TransactionStatus, TransactionType } from "../domain/types/entities";
import { assertCents } from "../domain/money/cents";

type Page = "dashboard" | "contas" | "transacoes" | "cartoes" | "mais";
const emptyData: EntityCollection = { people: [], categories: [], accounts: [], cards: [], transactions: [], installmentGroups: [] };
const repo = new IndexedDbFinanceRepository();

function money(cents:number) {
  return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(cents / 100);
}

function todayFinancialDate() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }\n\nfunction todayMonth() {
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
  const [remoteVersion,setRemoteVersion]=useState(0);
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
  function reset(){setEditing(null);setName("");setType("CHECKING");setOpening("");setError("");}
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

function parseAmount(value:string):number{const normalized=value.trim().replace(/\\./g,"").replace(",",".");const n=Number(normalized);if(!Number.isFinite(n)||n<0)throw new Error("Informe um valor válido.");const cents=Math.round(n*100);assertCents(cents,"amountCents");return cents}

function Transactions({data,onChange}:{data:EntityCollection;onChange:(next:EntityCollection)=>Promise<void>}) {
 const [editing,setEditing]=useState<Transaction|null>(null);const [type,setType]=useState<TransactionType>("EXPENSE");const [status,setStatus]=useState<TransactionStatus>("PAID");const [date,setDate]=useState(()=>todayFinancialDate());const [amount,setAmount]=useState("");const [description,setDescription]=useState("");const [categoryId,setCategoryId]=useState("");const [accountId,setAccountId]=useState("");const [destinationAccountId,setDestinationAccountId]=useState("");const [creditCardId,setCreditCardId]=useState("");const [personId,setPersonId]=useState("");const [filter,setFilter]=useState<"ALL"|"INCOME"|"EXPENSE"|"TRANSFER"|"CARD_PAYMENT">("ALL");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const activeAccounts=data.accounts.filter(a=>a.active),activeCards=data.cards.filter(c=>c.active),activePeople=data.people.filter(p=>p.active);
 const activeCategories=data.categories.filter(c=>c.active&&((type==="INCOME"||type==="EXPENSE")?c.kind===(type==="INCOME"?"INCOME":"EXPENSE"):false));
 const visible=data.transactions.filter(t=>filter==="ALL"||t.type===filter).sort((a,b)=>b.date.localeCompare(a.date));
 function reset(){setEditing(null);setType("EXPENSE");setStatus("PAID");setDate(todayFinancialDate());setAmount("");setDescription("");setCategoryId("");setAccountId("");setDestinationAccountId("");setCreditCardId("");setPersonId("");setError("")}
 function edit(t:Transaction){setEditing(t);setType(t.type);setStatus(t.status);setDate(t.date);setAmount((t.amountCents/100).toFixed(2).replace(".",","));setDescription(t.description);setCategoryId(t.categoryId??"");setAccountId(t.accountId??"");setDestinationAccountId(t.destinationAccountId??"");setCreditCardId(t.creditCardId??"");setPersonId(t.personId??"");setError("")}
 async function save(){setError("");try{const amountCents=parseAmount(amount);const tx:Transaction={id:editing?.id??crypto.randomUUID(),date,type,status,amountCents,description:description.trim(),...(categoryId?{categoryId}:{}),...(accountId?{accountId}:{}),...(destinationAccountId?{destinationAccountId}:{}),...(creditCardId?{creditCardId}:{}),...(personId?{personId}: {})};validateTransaction(tx,{accounts:data.accounts,cards:data.cards,transactions:data.transactions});const next={...data,transactions:editing?data.transactions.map(t=>t.id===tx.id?tx:t):[...data.transactions,tx]};setBusy(true);await onChange(next);reset()}catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar o lançamento.")}finally{setBusy(false)}}
 async function cancel(t:Transaction){if(t.status==="CANCELLED")return;if(!confirm("Cancelar este lançamento? O histórico será preservado."))return;setBusy(true);setError("");try{await onChange({...data,transactions:data.transactions.map(x=>x.id===t.id?{...x,status:"CANCELLED"}:x)})}catch(e){setError(e instanceof Error?e.message:"Não foi possível cancelar.")}finally{setBusy(false)}}
 function labelType(t:Transaction){return t.type==="TRANSFER"?"Transferência":t.type==="CARD_PAYMENT"?"Pagamento de cartão":t.type==="INCOME"?"Entrada":t.creditCardId?"Compra no cartão":"Saída"}
 return <div className="page-content"><div className="page-heading"><div><span className="eyebrow">Movimentação</span><h1>Transações</h1></div><button className="primary compact" onClick={reset}>+ Novo lançamento</button></div>
 {error&&<div className="global-alert">{error}</div>}<div className="transaction-filters">{(["ALL","INCOME","EXPENSE","TRANSFER","CARD_PAYMENT"] as const).map(f=><button key={f} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f==="ALL"?"Todos":f==="INCOME"?"Entradas":f==="EXPENSE"?"Saídas":f==="TRANSFER"?"Transferências":"Cartão"}</button>)}</div>
 <section className="panel transaction-list">{visible.length===0?<Empty text="Nenhum lançamento encontrado."/>:visible.map(t=><div className="transaction-row" key={t.id}><div><strong>{t.description||labelType(t)}</strong><span>{t.date} · {labelType(t)} · {t.status}</span></div><div className="transaction-value"><strong>{t.type==="EXPENSE"||t.type==="CARD_PAYMENT"?"−":"+"}{money(t.amountCents)}</strong><div className="row-actions"><button className="link-button" onClick={()=>edit(t)}>Editar</button>{t.status!=="CANCELLED"&&<button className="link-button danger" disabled={busy} onClick={()=>void cancel(t)}>Cancelar</button>}</div></div></div>)}</section>
 <section className="panel form-panel"><h2>{editing?"Editar lançamento":"Novo lançamento"}</h2><div className="form-grid">
 <label>Tipo<select value={type} onChange={e=>{setType(e.target.value as TransactionType);setCategoryId("");setCreditCardId("")}}><option value="EXPENSE">Saída</option><option value="INCOME">Entrada</option><option value="TRANSFER">Transferência</option><option value="CARD_PAYMENT">Pagamento de cartão</option></select></label>
 <label>Status<select value={status} onChange={e=>setStatus(e.target.value as TransactionStatus)}>{type==="INCOME"?<><option value="RECEIVED">Recebido</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>:<><option value="PAID">Pago</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>}{status==="CANCELLED"&&<option value="CANCELLED">Cancelado</option>}</select></label>
 <label>Data<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label><label>Valor<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0,00" required/></label><label>Descrição<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Ex.: Mercado"/></label>
 {(type==="INCOME"||type==="EXPENSE")&&<label>Categoria<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Selecione</option>{activeCategories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
 <label>{type==="TRANSFER"?"Conta de origem":"Conta"}<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Selecione</option>{activeAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
 {type==="TRANSFER"&&<label>Conta de destino<select value={destinationAccountId} onChange={e=>setDestinationAccountId(e.target.value)}><option value="">Selecione</option>{activeAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
 {type==="EXPENSE"&&<label>Cartão de crédito (opcional)<select value={creditCardId} onChange={e=>setCreditCardId(e.target.value)}><option value="">Nenhum / conta</option>{activeCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
 {type==="CARD_PAYMENT"&&<label>Cartão<select value={creditCardId} onChange={e=>setCreditCardId(e.target.value)}><option value="">Selecione</option>{activeCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
 {type!=="TRANSFER"&&<label>Pessoa (opcional)<select value={personId} onChange={e=>setPersonId(e.target.value)}><option value="">Nenhuma</option>{activePeople.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
 </div><div className="form-actions"><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Salvando…":editing?"Salvar alterações":"Registrar lançamento"}</button>{editing&&<button className="secondary" onClick={reset}>Cancelar edição</button>}</div><p className="form-note">Compra no cartão não reduz a conta. O pagamento da fatura movimenta a conta e não cria outra despesa.</p></section></div>;
}

function AppShell({user,family,onSignOut}:{user:User;family:Family;onSignOut:()=>Promise<void>}) {
  const [page,setPage]=useState<Page>("dashboard");
  const [data,setData]=useState<EntityCollection>(emptyData);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try {
        const local:EntityCollection={people:await repo.list("people"),categories:await repo.list("categories"),accounts:await repo.list("accounts"),cards:await repo.list("cards"),transactions:await repo.list("transactions"),installmentGroups:await repo.list("installmentGroups")};
        if(!cancelled)setData(local);
        const remote=await pullFinanceState(family.id);
        if(remote && !cancelled){ await repo.replaceAll(remote.state); setData(remote.state); setRemoteVersion(remote.version); }
      } catch(e){ if(!cancelled)setError(e instanceof Error?e.message:"Falha ao carregar dados."); }
      finally{if(!cancelled)setLoading(false);}
    })();
    return ()=>{cancelled=true};
  },[family.id]);
  async function persist(next:EntityCollection){
    await repo.replaceAll(next); setData(next);
    const result=await pushFromLocalFirst(family.id,next,remoteVersion);
    if(result.kind==="pushed"){setRemoteVersion(result.version);return;}
    throw new Error("Os dados online foram alterados em outro aparelho. A alteração local foi preservada, mas não foi enviada.");
  }
  const content = page==="dashboard" ? <Dashboard data={data}/> :
    page==="contas" ? <Accounts data={data} onChange={persist}/> :
    page==="transacoes" ? <Transactions data={data} onChange={persist}/> : :
    page==="cartoes" ? <Placeholder title="Cartões" text="Cartões, faturas e pagamentos serão conectados ao motor de cartão sem duplicar despesas."/> :
    <Placeholder title="Mais" text="Parcelamentos, recorrências, caixinhas, orçamentos, relatórios e assistente serão adicionados por etapas."/>;
  return <div className="shell">
    <header className="topbar"><div><strong>Controle Familiar</strong><span>{family.name}</span></div><button className="icon-button" onClick={()=>void onSignOut()}>Sair</button></header>
    {error && <div className="global-alert">{error}</div>}{loading ? <div className="loading">Carregando dados financeiros…</div> : content}
    <nav className="bottom-nav">{([["dashboard","Início","⌂"],["contas","Contas","▣"],["transacoes","Lançamentos","＋"],["cartoes","Cartões","▤"],["mais","Mais","•••"]] as const).map(([key,label,icon])=><button className={page===key?"active":""} key={key} onClick={()=>setPage(key)}><span>{icon}</span><small>{label}</small></button>)}</nav>
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