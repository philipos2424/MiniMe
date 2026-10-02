'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function GettingStarted({ business, initData }) {
  const [checklist, setChecklist] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    let off = false;
    setChecklist(null);
    try { setDismissed(localStorage.getItem(`minime_setup_${business?.id}`) === 'hidden'); } catch {}
    if (!initData || !business?.id) return;
    fetch('/api/onboarding/checklist', {headers:{'x-telegram-init-data':initData},cache:'no-store'})
      .then(async r => { if (r.ok) { const data = await r.json(); if (!off) setChecklist(data); } }).catch(()=>{});
    return () => { off = true; };
  }, [business?.id,initData]);
  if (!checklist || dismissed || checklist.first_chat) return null;
  const items = [
    !checklist.taught && !checklist.products && {href:'/teach',label:'Add your business knowledge',hint:'Give MiniMe the facts it needs before inviting customers.'},
    {href:'/settings/bot',label:'Share your customer link',hint:'Invite a customer to start your first conversation.'},
    !checklist.links && {href:'/settings',label:'Complete your business profile',hint:'Add customer-facing contact details and useful links.'},
  ].filter(Boolean).slice(0,3);
  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(`minime_setup_${business.id}`, 'hidden'); } catch {}
  }
  return <section aria-label="Your next step" style={{maxWidth:1120,margin:'20px auto',padding:'22px 24px',border:'1px solid var(--line)',borderRadius:16,background:'var(--card)',color:'var(--ink)'}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center'}}><h2 style={{fontFamily:'Newsreader, Georgia, serif',fontSize:25,fontWeight:400,margin:0}}>A good next step</h2><button onClick={dismiss} style={{minHeight:44,background:'none',border:0,color:'var(--muted)',cursor:'pointer',textDecoration:'underline'}}>Hide setup tips</button></div>
    <Link href={items[0].href} style={{display:'block',padding:'14px 0',color:'inherit',textDecoration:'none'}}><strong>{items[0].label} →</strong><p style={{margin:'4px 0 0',fontSize:14,color:'var(--muted)'}}>{items[0].hint}</p></Link>
    {items.slice(1).map(item=><Link href={item.href} key={item.href} style={{display:'block',padding:'12px 0',minHeight:44,borderTop:'1px solid var(--line)',color:'var(--muted)',fontSize:14}}>{item.label}</Link>)}
  </section>;
}
