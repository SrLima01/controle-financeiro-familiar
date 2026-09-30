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
     <label>Status<select value={status} onChange={e=>setStatus(e.target.value as RecurringRule["status"])}>{type==="INCOME"?<><option value="RECEIVED">Recebido</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>:<><option value="PAID">Pago</option><option value="PENDING">Pendente</option><option value="PLANNED">Planejado</option></>}</select></label>
     <label>Data<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>
     <label>Valor total<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0,00" required/></label>
     <label>Descrição<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Ex.: Mercado"/></label>
     {(type==="INCOME"||type==="EXPENSE")&&<label>Categoria<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Selecione</option>{activeCategories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
     <label>{type==="TRANSFER"?"Conta de origem":type==="CARD_PAYMENT"?"Conta de pagamento":"Conta"}<select value={accountId} onChange={e=>{setAccountId(e.target.value);if(e.target.value&&type!=="CARD_PAYMENT")setCreditCardId("")}} disabled={type==="CARD_PAYMENT"&&!!creditCardId}><option value="">Selecione</option>{(type==="CARD_PAYMENT"&&creditCardId?data.accounts.filter(a=>a.id===data.cards.find(c=>c.id===creditCardId)?.accountId):activeAccounts).map(a=><option key={a.id} value={a.id}>{a.name}{a.active?"":" (arquivada)"}</option>)}</select></label>
     {type==="TRANSFER"&&<label>Conta de destino<select value={destinationAccountId} onChange={e=>setDestinationAccountId(e.target.value)}><option value="">Selecione</option>{activeAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
     {type==="EXPENSE"&&<label>Cartão de crédito (opcional)<select value={creditCardId} onChange={e=>{setCreditCardId(e.target.value);if(e.target.value)setAccountId("")}}><option value="">Nenhum / conta</option>{activeCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
     {type==="CARD_PAYMENT"&&<label>Cartão<select value={creditCardId} onChange={e=>{const id=e.target.value;setCreditCardId(id);const card=data.cards.find(c=>c.id===id);setAccountId(card?.accountId??"")}}><option value="">Selecione</option>{activeCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
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
 const [status,setStatus]=useState<"PENDING"|"PAID"|"RECEIVED"|"PLANNED">("PLANNED");
 const [accountId,setAccountId]=useState("");
 const [creditCardId,setCreditCardId]=useState("");
 const [categoryId,setCategoryId]=useState("");
 const [personId,setPersonId]=useState("");
 const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 const activeAccounts=data.accounts.filter(a=>a.active),activeCards=data.cards.filter(c=>c.active),activePeople=data.people.filter(p=>p.active);
 const activeCategories=data.categories.filter(c=>c.active&&c.kind===type);
 function reset(){setEditing(null);setDescription("");setFrequency("MONTHLY");setStartDate(todayFinancialDate());setEndDate("");setAmount("");setType("EXPENSE");setStatus("PLANNED");setAccountId("");setCreditCardId("");setCategoryId("");setPersonId("");setError("")}
 function edit(rule:RecurringRule){
   setEditing(rule);setDescription(rule.description);setFrequency(rule.frequency);setStartDate(rule.startDate);setEndDate(rule.endDate??"");setAmount((rule.amountCents/100).toFixed(2).replace(".",","));setType(rule.type);setStatus(rule.status);setAccountId(rule.accountId??"");setCreditCardId(rule.creditCardId??"");setCategoryId(rule.categoryId??"");setPersonId(rule.personId??"");setError("");
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