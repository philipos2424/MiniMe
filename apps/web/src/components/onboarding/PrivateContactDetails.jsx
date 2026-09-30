'use client';
import { useEffect, useState } from 'react';

export default function PrivateContactDetails({ initData, businessId }) {
  const [open,setOpen]=useState(false);
  const [values,setValues]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!open || !initData) return;
    let off=false;
    setError('');setValues(null);
    fetch('/api/onboarding/progress',{headers:{'x-telegram-init-data':initData},cache:'no-store'}).then(async r=>{
      const data=await r.json();if(!r.ok) throw new Error('Could not load private contact details.');
      if(!off) setValues({owner_contact_email:data.owner_contact_email||'',owner_contact_phone:data.owner_contact_phone||''});
    }).catch(e=>{if(!off)setError(e.message);});
    return()=>{off=true;};
  },[open,initData,businessId,retry]);
  async function save(e) {
    e.preventDefault(); if(busy)return;setBusy(true);setError('');setSaved(false);
    try {
      const r=await fetch('/api/onboarding/progress',{method:'PATCH',headers:{'Content-Type':'application/json','x-telegram-init-data':initData},body:JSON.stringify(values)});
      const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not save private contact details.');setSaved(true);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <details onToggle={e=>setOpen(e.currentTarget.open)} style={{padding:20,marginBottom:20,border:'1px solid var(--line)',borderRadius:18,background:'var(--card)',color:'var(--ink)'}}>
    <summary style={{minHeight:44,cursor:'pointer',fontWeight:600}}>Private owner contact details</summary>
    <p style={{fontSize:14,color:'var(--muted)'}}>Only used to contact you. Never shared with customers. Leave a field blank to remove it.</p>
    {values ? <form onSubmit={save}>{[['owner_contact_email','Email address','email'],['owner_contact_phone','Phone number with country code','tel']].map(([id,label,type])=><label key={id} htmlFor={`private-${id}`} style={{display:'block',fontSize:14,marginBottom:16}}>{label} · Optional<input id={`private-${id}`} type={type} value={values[id]} onChange={e=>{setValues({...values,[id]:e.target.value});setSaved(false);}} disabled={busy} maxLength={type==='email'?254:32} style={{display:'block',width:'100%',fontSize:16,padding:12,minHeight:48,borderRadius:10,border:'1px solid var(--line)',background:'var(--paper)',color:'var(--ink)',marginTop:8}}/></label>)}<button type="submit" disabled={busy} style={{minHeight:48,padding:'12px 18px',borderRadius:10,border:0,background:'var(--ink)',color:'var(--paper)',cursor:'pointer'}}>{busy?'Saving…':'Save private contacts'}</button></form>:!error && <p role="status">Loading…</p>}
    {error&&<p role="alert">{error} {!values&&<button type="button" onClick={()=>setRetry(n=>n+1)}>Retry</button>}</p>}
    {saved&&<p role="status">Private contact details saved.</p>}
  </details>;
}
