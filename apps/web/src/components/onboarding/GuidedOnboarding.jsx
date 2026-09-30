'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, Copy, LockKeyhole, MessageCircle } from 'lucide-react';
import { MiniMeLogo } from '../ui/MiniMeLogo';
import { CATEGORIES, COUNTRIES, CURRENCIES, ONBOARDING_TRIAL, STAGE, resumeScreen, suggestedCurrency } from '../../lib/onboarding-config.mjs';
import styles from './GuidedOnboarding.module.css';

const EMPTY = { screen:'business', completed:[], name:'', offer:'', picked_offerings:[], question:'', answer:'', savedOffer:'', savedAnswer:'', correction:'', previewQuestion:'', knowledge:false, uploaded:false, uploadName:'', country_code:'', currency:'', category:'', owner_name:'', owner_contact_email:'', owner_contact_phone:'' };
const PROTOTYPE_OFFERS = ['Repairs', 'Accessories', 'Custom orders', 'New arrivals', 'Gift options', 'Advice'];
const PROTOTYPE_NAME_HINTS = [
  { terms:['phone', 'mobile', 'tech', 'electronic', 'computer'], offers:['Phone repairs', 'Device accessories', 'Chargers', 'Screen repairs', 'Device advice'] },
  { terms:['salon', 'beauty', 'spa', 'barber', 'hair'], offers:['Hair styling', 'Haircuts', 'Beauty services', 'Appointments', 'Product advice'] },
  { terms:['cafe', 'coffee', 'restaurant', 'kitchen', 'grill', 'pizza', 'bakery', 'mango'], offers:['Meals', 'Drinks', 'Takeaway', 'Fresh options', 'Order help'] },
  { terms:['fashion', 'boutique', 'wear', 'style', 'clothing'], offers:['Clothing', 'Accessories', 'New arrivals', 'Custom orders', 'Style advice'] },
  { terms:['repair', 'garage', 'auto', 'car'], offers:['Repairs', 'Parts', 'Service bookings', 'Maintenance', 'Repair advice'] },
];
function prototypeOffers(name) {
  const normalized = String(name || '').toLowerCase();
  return PROTOTYPE_NAME_HINTS.find(({terms}) => terms.some(term => normalized.includes(term)))?.offers || PROTOTYPE_OFFERS;
}
const TITLES = { business:'Your business, with a little help.', offer:'What does your business offer?', answer:'Pick a customer question.', preview:'Here’s how MiniMe could answer.', location:'Where is your business based?', contact:'How can we contact you?', review:'Ready to turn MiniMe on?', success:'Your MiniMe is ready.' };
const INTRO = { business:'MiniMe helps answer your customers on Telegram using your business information.', offer:'Start with what you offer. Then choose one customer question MiniMe should know how to handle.', answer:'Choose a common customer question, then tap the answer that sounds most like your business.', preview:'A small first step. Check the reply, and change anything that needs your touch.', location:'This helps MiniMe show your prices correctly.', contact:'Confirm your name, and add contact details if you’d like us to reach you outside Telegram.', review:'One last detail, then MiniMe is ready for customers who use your link.', success:'Share your customer link so people can start a conversation with your MiniMe.' };

function Field({ id, label, optional, hint, children }) {
  return <div className={styles.field}><label htmlFor={id}>{label}{optional && <span className={styles.optional}> · Optional</span>}</label>{children}{hint && <p id={`${id}-hint`} className={styles.hint}>{hint}</p>}</div>;
}
function statePayload(draft) {
  return Object.fromEntries(['screen','completed','name','offer','picked_offerings','question','answer','savedOffer','savedAnswer','correction','previewQuestion','knowledge','uploaded','uploadName'].map(key => [key, draft[key]]));
}

export default function GuidedOnboarding({ initData, business, telegramUser, setBusiness, preview = false, onExit, referralCode }) {
  const [draft, setDraft] = useState(EMPTY);
  const draftRef = useRef(EMPTY);
  const [ready, setReady] = useState(preview);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState('');
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reply, setReply] = useState(null);
  const [editing, setEditing] = useState(false);
  const [correction, setCorrection] = useState('');
  const [countryText, setCountryText] = useState('');
  const [customerLink, setCustomerLink] = useState('');
  const [sessionBusiness, setSessionBusiness] = useState(business);
  const hydrated = useRef(false);
  const alive = useRef(true);
  const titleRef = useRef(null);
  const scrollRef = useRef(null);
  const [suggestions, setSuggestions] = useState({ offerings:[], questions:[] });
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
  const suggestionsKey = useRef('');
  const rootRef = useRef(null);
  const formRef = useRef(null);
  const returnToReview = useRef(false);
  const begunAt = useRef(Date.now());
  const key = `minime_onboarding_v2_${telegramUser?.id || 'anonymous'}`;
  const screen = draft.screen;
  const businessLabel = draft.name.trim().length > 36 ? `${draft.name.trim().slice(0, 35)}…` : draft.name.trim();
  const heading = {
    ...TITLES,
    offer: businessLabel ? `What does ${businessLabel} offer?` : TITLES.offer,
    answer: businessLabel ? `What do customers ask ${businessLabel}?` : TITLES.answer,
    preview: businessLabel ? `Meet your ${businessLabel} MiniMe.` : TITLES.preview,
    success: 'Ready for your first customer.',
  }[screen];

  const update = useCallback((patch) => {
    const value = { ...draftRef.current, ...patch };
    draftRef.current = value;
    setDraft(value);
    return value;
  }, []);
  const request = useCallback(async (url, body, method = 'POST') => {
    const response = await fetch(url, { method, headers:{ 'Content-Type':'application/json', 'x-telegram-init-data':initData }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Your Telegram session expired. Close and reopen MiniMe. Your draft is saved on this device.');
    if (!response.ok || result.ok === false || result.error) {
      const messages = {session_expired:'This preview expired. Cancel the edit, try the question again, then save your answer.',save_failed:'Your answer did not save. Please try again.',no_draft:'MiniMe could not prepare a reply yet. Try again or continue setup.',too_many_requests:'Please wait a moment before trying again.'};
      throw new Error(messages[result.error] || result.hint || result.error || 'That didn’t save. Please try again.');
    }
    return result;
  }, [initData]);
  const track = useCallback((step, meta = {}) => {
    if (preview || !initData) return;
    fetch('/api/onboarding/track', { method:'POST', headers:{'Content-Type':'application/json','x-telegram-init-data':initData}, body:JSON.stringify({step,meta}) }).catch(() => {});
  }, [preview, initData]);

  const loadSuggestions = useCallback(async (selected = []) => {
    const selectedOffer = selected[0] || '';
    const fallbackQuestions = selected.length ? [
      { question:`Do you have ${selectedOffer.toLowerCase()} available?`, answers:['Yes — tell us what you need and we’ll check the current options.', 'Message us with what you’re looking for and we’ll confirm availability.'] },
      { question:`How much are your ${selectedOffer.toLowerCase()}?`, answers:['Prices depend on the option. Tell us what you have in mind and we’ll share today’s price.', 'Send us the item you’re interested in and we’ll send the current price.'] },
      { question:`Can you help me choose ${selectedOffer.toLowerCase()}?`, answers:[`Of course. Tell us what you need and we’ll help you choose the right ${selectedOffer.toLowerCase()}.`, 'Yes — send us a few details and we’ll recommend an option.'] },
    ] : [];
    setSuggestionsBusy(true);
    try {
      if (preview) {
        setSuggestions({ offerings:prototypeOffers(draftRef.current.name), questions:fallbackQuestions });
        return;
      }
      const result = await request('/api/onboarding/offerings', { selected_offerings:selected });
      const returnedOffers = Array.isArray(result.offerings) ? result.offerings : [];
      // Keep selected facts visible while the assistant improves the remaining choices.
      setSuggestions({ offerings:[...new Set([...selected, ...returnedOffers])], questions:Array.isArray(result.questions) ? result.questions : fallbackQuestions });
    } catch (e) {
      if (selected.length) setSuggestions({ offerings:[], questions:fallbackQuestions });
      else setError('MiniMe could not make suggestions yet. Please retry.');
    } finally {
      if (alive.current) setSuggestionsBusy(false);
    }
  }, [preview, request]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (hydrated.current) return;
    let cancelled = false;
    async function hydrate() {
      try {
        setError('');
        const profile = !preview && business?.id ? await request('/api/onboarding/progress', undefined, 'GET') : {};
        if (cancelled) return;
        let local = null, legacy = null;
        if (!preview) try {
          const stored = JSON.parse(localStorage.getItem(key) || 'null');
          if (stored && Date.now() - stored.savedAt < 7 * 86400000) local = stored.draft;
          legacy = JSON.parse(localStorage.getItem('minime_onb_resume_v1') || 'null');
        } catch {}
        const initial = { ...EMPTY, name:business?.name && !/^(My Business|.*'s Business)$/.test(business.name) ? business.name : '', owner_name:business?.owner_name || [telegramUser?.first_name, telegramUser?.last_name].filter(Boolean).join(' '), category:business?.category || '', currency:profile.country_code ? business?.currency || '' : '', ...profile, ...profile.state, ...local };
        initial.screen = resumeScreen(local?.screen || profile.state?.screen || legacy?.screen);
        // An already-completed account is handled by the live page wrapper.
        if (initial.screen === 'success') initial.screen = 'review';
        if (!business?.id && !preview) initial.screen = 'business';
        if (initial.screen === 'preview' && !initial.knowledge) initial.screen = 'offer';
        if (initial.screen === 'answer') initial.screen = 'offer';
        if (['location','contact'].includes(initial.screen)) initial.screen = 'review';
        if (!initial.picked_offerings?.length && initial.offer) initial.picked_offerings = [initial.offer].filter(Boolean);
        update(initial);
        setCorrection(initial.correction || '');
        setCountryText(COUNTRIES.find(c => c.code === initial.country_code)?.name || '');
        hydrated.current = true;
        setReady(true);
      } catch (e) { if (!cancelled) setError(e.message); }
    }
    hydrate();
    return () => { cancelled = true; };
  }, [business, key, loadAttempt, preview, request, telegramUser, update]);

  useEffect(() => {
    if (!ready || preview || screen === 'success') return;
    try { localStorage.setItem(key, JSON.stringify({ savedAt:Date.now(), draft })); } catch {}
  }, [draft, key, ready, preview, screen]);
  useEffect(() => {
    if (!ready) return;
    setError(''); setNotice(''); setEditing(false);
    titleRef.current?.focus({ preventScroll:true });
    scrollRef.current?.scrollTo(0,0);
    track(`v2_${screen}`);
    if (screen === 'review') track('trial_disclosed');
  }, [screen, ready, track]);
  useEffect(() => {
    if (!ready || screen !== 'offer') return;
    const selected = draft.picked_offerings || [];
    const currentKey = `${screen}:${draft.name}:${selected.join('|')}`;
    if (suggestionsKey.current === currentKey) return;
    suggestionsKey.current = currentKey;
    loadSuggestions(selected);
  }, [draft.name, draft.picked_offerings, loadSuggestions, ready, screen]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (rootRef.current && viewport) {
        rootRef.current.style.height = `${viewport.height}px`;
        rootRef.current.style.top = `${viewport.offsetTop}px`;
      }
    };
    resize(); viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize);
    return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); };
  }, []);

  async function run(label, work) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError(''); setNotice('');
    try { await work(); }
    catch (e) { if (alive.current) { setError(e.message || 'Something went wrong. Please try again.'); track('v2_error', {screen}); } }
    finally { lock.current = false; if (alive.current) setBusy(''); }
  }
  async function persist(next, fields = {}) {
    if (!preview) await request('/api/onboarding/progress', { ...fields, state:statePayload(next) }, 'PATCH');
  }
  async function go(nextScreen, patch = {}, fields = {}, complete = true) {
    const current = draftRef.current;
    const next = { ...current, ...patch, screen:nextScreen, completed:complete ? [...new Set([...current.completed, current.screen])] : current.completed };
    await persist(next, fields);
    update(next);
    if (complete) track('v2_stage_completed', {screen:current.screen});
  }
  function back() {
    if (lock.current) return;
    const previous = { offer:'business', answer:'offer', preview:'offer', location:'preview', contact:'preview', review:'preview' }[screen];
    if (previous) run('Saving your progress…', () => go(previous, {}, {}, false));
  }
  useEffect(() => {
    if (preview) return;
    const button = window.Telegram?.WebApp?.BackButton;
    if (!button) return;
    if (screen === 'business' || screen === 'success') button.hide(); else button.show();
    button.onClick(back);
    return () => { button.offClick(back); button.hide(); };
  });
  async function teach(text) {
    if (preview) return;
    const result = await request('/api/teach', {description:text});
    if (!result.result?.description?.ok) throw new Error('MiniMe could not save that knowledge yet. Please try again.');
  }
  async function generate(question) {
    setReply(null);
    const result = preview ? { reply:draftRef.current.answer || `We offer ${draftRef.current.picked_offerings.join(', ')}.`, conversation_id:'prototype' }
      : await request('/api/onboarding/preview', {message:question});
    if (!result.reply) throw new Error('MiniMe couldn’t prepare a reply yet. Try again, or continue setup and test it later.');
    setReply({...result,question});
    update({previewQuestion:question, ...(question !== draftRef.current.previewQuestion ? {correction:''} : {})});
    track('v2_preview_shown', {elapsed_ms:Date.now()-begunAt.current});
  }
  async function previewKnowledge() {
    await go('preview');
    await generate(draftRef.current.question.trim() || 'What products or services do you offer?');
  }
  async function submit() {
    const d = draftRef.current;
    if (screen === 'preview') return run('Saving your progress…', () => go('review'));
    if (screen === 'success') { onExit?.(); return; }
    if (!formRef.current?.reportValidity()) return;
    run(screen === 'review' ? 'Activating your MiniMe…' : 'Saving your information…', async () => {
      if (screen === 'business') {
        if (!preview) {
          const signup = await request('/api/onboarding/signup', referralCode ? {referral_code:referralCode} : {});
          if (!signup.business) throw new Error('Your account could not be created. Please retry.');
          setSessionBusiness(signup.business); setBusiness?.(signup.business); track('signup');
          const saved = await request('/api/onboarding/business', {name:d.name.trim()});
          if (!saved.business) throw new Error('Your business could not be saved. Please retry.');
          setSessionBusiness(saved.business); setBusiness?.(saved.business);
        }
        await go(returnToReview.current ? 'review' : 'offer', {name:d.name.trim()});
      } else if (screen === 'offer') {
        const offerStatement = `We offer: ${d.picked_offerings.join(', ')}.`;
        if (d.picked_offerings.length && d.savedOffer !== offerStatement) {
          await teach(offerStatement);
          update({knowledge:true, offer:offerStatement, savedOffer:offerStatement});
          track('v2_knowledge_saved');
        }
        const text = `Customer question: ${d.question.trim()}\nBusiness answer: ${d.answer.trim()}`;
        if (d.savedAnswer !== text) { await teach(text); update({knowledge:true,savedAnswer:text}); track('v2_knowledge_saved'); }
        setBusy('Preparing your reply…'); await previewKnowledge();
      } else if (screen === 'location') {
        if (!COUNTRIES.some(c => c.code === d.country_code)) throw new Error('Choose a country from the suggestions.');
        if (!CURRENCIES.includes(d.currency)) throw new Error('Choose your currency.');
        await go(returnToReview.current ? 'review' : 'contact', {}, {country_code:d.country_code,currency:d.currency,category:d.category});
      } else if (screen === 'contact') {
        await go('review', {}, {owner_name:d.owner_name,owner_contact_email:d.owner_contact_email,owner_contact_phone:d.owner_contact_phone});
        track('v2_contact_saved', {email_provided:!!d.owner_contact_email.trim(),phone_provided:!!d.owner_contact_phone.trim()});
      } else if (screen === 'review') {
        if (!d.name.trim() || !d.owner_name.trim() || !d.country_code || !d.currency) throw new Error('Add your country, currency, and name before activation.');
        await persist(d, {country_code:d.country_code,currency:d.currency,category:d.category,owner_name:d.owner_name,owner_contact_email:d.owner_contact_email,owner_contact_phone:d.owner_contact_phone});
        track('v2_contact_saved', {email_provided:!!d.owner_contact_email.trim(),phone_provided:!!d.owner_contact_phone.trim()});
        if (preview) setCustomerLink('https://t.me/MiniMeAgentBot?start=shop_example');
        else {
          const activated = await request('/api/onboarding/complete-shared', {});
          if (!activated.business?.onboarding_completed || !activated.shop_code) throw new Error('Activation was not confirmed. Please try again.');
          setSessionBusiness(activated.business); setBusiness?.(activated.business);
          setCustomerLink(`https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || 'MiniMeAgentBot'}?start=shop_${encodeURIComponent(activated.shop_code)}`);
          try { localStorage.removeItem(key); localStorage.removeItem('minime_onb_resume_v1'); } catch {}
          track('connected_shared'); track('trial_started');
        }
        // Activation has succeeded. A subsequent progress write must not hide it.
        update({screen:'success'});
      }
      if (draftRef.current.screen === 'review') returnToReview.current = false;
    });
  }
  function skipTeaching() {
    run('Saving your progress…', async () => {
      track('v2_teaching_skipped', {screen});
      await go('review');
    });
  }
  function edit(screen) { returnToReview.current = true; run('Saving your progress…', () => go(screen, {}, {}, false)); }
  function chooseCountry(value) {
    setCountryText(value);
    const found = COUNTRIES.find(c => c.name.toLowerCase() === value.toLowerCase() || c.code.toLowerCase() === value.toLowerCase());
    update({country_code:found?.code || '', currency:found ? suggestedCurrency(found.code) || draftRef.current.currency : draftRef.current.currency});
  }
  async function saveCorrection() {
    run('Saving your answer…', async () => {
      if (!correction.trim() || correction.trim().length < 4) throw new Error('Please write an answer of at least four characters.');
      if (!preview) await request('/api/onboarding/edit-reply', {conversation_id:reply.conversation_id,corrected_text:correction.trim()});
      setReply({...reply,reply:correction.trim()}); update({correction:''}); setEditing(false); setNotice('Answer saved. MiniMe can use this for similar questions.');
      track('v2_answer_corrected');
    });
  }
  const label = {business:'Set up my MiniMe',offer:'See my MiniMe reply',answer:'See MiniMe reply',preview:'Continue setup',location:'Continue',contact:'Review setup',review:'Turn on MiniMe',success:preview ? 'Finish prototype' : 'Open my dashboard'}[screen];
  const inactive = !!busy || !ready || (screen === 'offer' && (!draft.picked_offerings.length || !draft.question || !draft.answer));
  const input = (id, type='text', extra={}) => <input id={id} className={styles.input} type={type} value={draft[id]} onChange={e => update({[id]:e.target.value})} disabled={!!busy} {...extra} />;

  return <div className={styles.root} ref={rootRef}>
    {preview && <div className={styles.testBanner}>Interactive prototype · No account changes or messages sent</div>}
    <header className={styles.header}>
      <div className={styles.brand}><div className={styles.wordmark}><MiniMeLogo size={28} color="#183e35" accent="#a78748" />minime</div>{!['business','success'].includes(screen) && <button className={styles.back} type="button" onClick={back} disabled={!!busy}><ArrowLeft size={16}/>Back</button>}</div>
      <ol className={styles.progress} aria-label="Setup progress">{['Your business','See it work','Get ready'].map((name,i) => {
        const skipped = i === 1 && STAGE[screen] > i && !draft.completed.includes('preview');
        return <li key={name} className={skipped ? '' : STAGE[screen] > i ? styles.done : STAGE[screen] === i ? styles.active : ''} aria-current={STAGE[screen] === i ? 'step' : undefined}>{skipped ? 'Preview skipped' : name}{STAGE[screen] > i && !skipped && <span className={styles.hidden}> complete</span>}</li>;
      })}</ol>
    </header>
    <div className={styles.scroll} ref={scrollRef}>
      <main className={styles.content} key={screen}>
        {!ready ? <><h1 className={styles.title}>Let’s pick up where you left off.</h1><p role="status">{error || 'Loading your saved progress…'}</p>{error && <button className={styles.secondary} onClick={() => setLoadAttempt(n=>n+1)}>Retry</button>}</> : <>
          {screen === 'success' ? <div className={styles.success}><Check size={30}/></div> : <div className={styles.eyebrow}>{screen === 'business' ? 'A little less on your plate' : screen === 'preview' ? 'Made with your information' : screen === 'review' ? 'One last look' : 'Make it yours'}</div>}
          <h1 className={styles.title} tabIndex={-1} ref={titleRef}>{heading}</h1>
          <p className={styles.intro}>{INTRO[screen]}</p>
          <form ref={formRef} id="minime-onboarding" onSubmit={e => {e.preventDefault();submit();}}>
            {screen === 'business' && <>
              <Field id="name" label="Business name">{input('name','text',{required:true,maxLength:100,autoComplete:'organization',placeholder:'Your business name'})}</Field>
              <div className={styles.illustration}><MessageCircle size={25} strokeWidth={1.5}/><span>Add a little business knowledge.<br/>See a reply before you turn MiniMe on.</span></div>
              {telegramUser?.first_name && <p className={styles.hint}>Setting up with your Telegram account, {telegramUser.first_name}.</p>}
            </>}
            {screen === 'offer' && <>
              <div className={styles.pickerLabel}>Suggested for {draft.name || 'your business'}</div>
              {suggestionsBusy && !suggestions.offerings.length ? <div className={styles.pickerLoading} role="status">Making your choices…</div> : suggestions.offerings.length ? <div className={styles.tileGrid} aria-label="Suggested products and services">
                {suggestions.offerings.map(item => {
                  const selected = draft.picked_offerings.includes(item);
                  return <button key={item} type="button" className={styles.tile} aria-pressed={selected} onClick={()=>update({ picked_offerings:selected ? draft.picked_offerings.filter(v=>v!==item) : [...draft.picked_offerings,item].slice(0,8), question:'', answer:'' })} disabled={!!busy}>
                    <span className={styles.tileCheck}>{selected ? <Check size={16}/> : ''}</span>{item}
                  </button>;
                })}
              </div> : <button type="button" className={styles.secondary} onClick={()=>{suggestionsKey.current='';loadSuggestions();}} disabled={!!busy}>Try suggestions again</button>}
              {!suggestionsBusy && suggestions.offerings.length > 0 && <button type="button" className={`${styles.link} ${styles.refreshChoices}`} onClick={()=>{suggestionsKey.current='';loadSuggestions(draft.picked_offerings);}} disabled={!!busy}>Show different choices</button>}
              <p className={styles.hint}>{draft.picked_offerings.length ? `${draft.picked_offerings.length} selected` : 'Choose at least one. You can add or change details later.'}</p>
              {draft.picked_offerings.length > 0 && <div className={styles.followUp}>
                <div className={styles.pickerLabel}>What customers are most likely to ask {businessLabel || 'you'}</div>
                {suggestionsBusy ? <div className={styles.questionLoading} role="status">Finding the most useful questions…</div> : <div className={styles.questionGrid} aria-label="Suggested customer questions">
                  {suggestions.questions.map(item => <button key={item.question} type="button" className={styles.questionTile} aria-pressed={draft.question===item.question} onClick={()=>update({question:item.question,answer:''})} disabled={!!busy}>{item.question}</button>)}
                </div>}
                {draft.question && <><div className={styles.pickerLabel} style={{marginTop:20}}>Choose the answer that fits</div><div className={styles.answerGrid} aria-label="Suggested answers">
                  {(suggestions.questions.find(item=>item.question===draft.question)?.answers || []).map(item => <button key={item} type="button" className={styles.answerTile} aria-pressed={draft.answer===item} onClick={()=>update({answer:item})} disabled={!!busy}>{draft.answer===item && <Check size={16}/>} {item}</button>)}
                </div></>}
              </div>}
            </>}
            {screen === 'answer' && <>
              <div className={styles.pickerLabel}>Choose a customer question</div>
              {suggestionsBusy ? <div className={styles.pickerLoading} role="status">Making your choices…</div> : <div className={styles.questionGrid} aria-label="Suggested customer questions">
                {suggestions.questions.map(item => <button key={item.question} type="button" className={styles.questionTile} aria-pressed={draft.question===item.question} onClick={()=>update({question:item.question,answer:''})} disabled={!!busy}>{item.question}</button>)}
              </div>}
              {draft.question && <><div className={styles.pickerLabel} style={{marginTop:28}}>Choose the answer that fits</div><div className={styles.answerGrid} aria-label="Suggested answers">
                {(suggestions.questions.find(item=>item.question===draft.question)?.answers || []).map(item => <button key={item} type="button" className={styles.answerTile} aria-pressed={draft.answer===item} onClick={()=>update({answer:item})} disabled={!!busy}>{draft.answer===item && <Check size={16}/>} {item}</button>)}
              </div></>}
              {!suggestionsBusy && !suggestions.questions.length && <button type="button" className={styles.secondary} onClick={()=>{suggestionsKey.current='';loadSuggestions(draft.picked_offerings);}}>Try questions again</button>}
            </>}
            {screen === 'preview' && <>
              <div className={styles.badge}><LockKeyhole size={14}/>{preview ? 'Prototype example — no AI request made' : 'Private test — nothing sent'}</div>
              {reply ? <div className={styles.card}>
                <div className={styles.chatLabel}>Customer</div><div className={styles.question}>{reply.question}</div>
                <div className={styles.chatLabel}><MiniMeLogo size={18} color="#183e35" accent="#a78748"/>MiniMe · {draft.name}</div>
                {editing ? <><Field id="correction" label="Edit MiniMe’s answer"><textarea id="correction" className={styles.textarea} value={correction} onChange={e=>{setCorrection(e.target.value);update({correction:e.target.value});}} maxLength={1500} disabled={!!busy}/></Field><button type="button" className={styles.secondary} onClick={saveCorrection} disabled={!!busy}>Save answer</button><button type="button" className={styles.link} onClick={()=>setEditing(false)} disabled={!!busy}>Cancel edit</button></> : <><div className={styles.reply}>{reply.reply}</div><div className={styles.learned} aria-label="Information used for this reply"><span>MiniMe used</span>{draft.picked_offerings.slice(0,3).map(item=><span className={styles.learnedPill} key={item}>{item}</span>)}<span className={styles.learnedPill}>Your selected answer</span></div><div className={styles.actions}><button type="button" className={styles.link} onClick={()=>{setCorrection(draft.correction || reply.reply);setEditing(true);}} disabled={!!busy}>Edit answer</button><button type="button" className={styles.link} onClick={()=>run('Choosing another question…',()=>go('offer',{question:'',answer:''},{},false))} disabled={!!busy}>Try another question</button></div></>}
              </div> : <div className={styles.card}><p>{busy ? 'Preparing a reply using your business information…' : 'Your knowledge is saved. Prepare a reply to see how MiniMe could use it.'}</p>{!busy && <button type="button" className={styles.link} onClick={()=>run('Preparing your reply…',()=>generate(draft.previewQuestion || draft.question || 'What products or services do you offer?'))}>Prepare reply</button>}</div>}
              <p className={styles.hint}>Check important details. You can teach MiniMe more and correct replies from your dashboard.</p>
            </>}
            {screen === 'location' && <>
              <Field id="country" label="Country or territory"><input id="country" list="minime-countries" className={styles.input} value={countryText} onChange={e=>chooseCountry(e.target.value)} placeholder="Search your country" required autoComplete="country-name" disabled={!!busy}/><datalist id="minime-countries">{COUNTRIES.map(c=><option key={c.code} value={c.name}/>)}</datalist></Field>
              <Field id="currency" label="Business currency" hint="Suggested from your country. Change it if you price in another currency."><select id="currency" className={styles.select} required value={draft.currency} onChange={e=>update({currency:e.target.value})} disabled={!!busy} aria-describedby="currency-hint"><option value="">Choose currency</option>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></Field>
              <Field id="category" label="Business type" optional><select id="category" className={styles.select} value={draft.category} onChange={e=>update({category:e.target.value})} disabled={!!busy}><option value="">Choose a type</option>{CATEGORIES.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></Field>
            </>}
            {screen === 'contact' && <>
              <Field id="owner_name" label="Your name">{input('owner_name','text',{required:true,maxLength:100,autoComplete:'name'})}</Field>
              <div className={styles.badge}><LockKeyhole size={15}/>Private contact details · Not shared with customers</div>
              <Field id="owner_contact_email" label="Email address" optional>{input('owner_contact_email','email',{maxLength:254,autoComplete:'email'})}</Field>
              <Field id="owner_contact_phone" label="Phone number" optional hint="Include the country code, for example +1 202 555 0123.">{input('owner_contact_phone','tel',{maxLength:32,autoComplete:'tel',inputMode:'tel','aria-describedby':'owner_contact_phone-hint'})}</Field>
            </>}
            {screen === 'review' && <>
              <div className={styles.miniSummary}><Check size={17}/><span>MiniMe knows about {draft.picked_offerings.slice(0,3).join(', ') || 'your business'} and one customer answer.</span></div>
              <Field id="country" label="Where is your business based?"><input id="country" list="minime-countries" className={styles.input} value={countryText} onChange={e=>chooseCountry(e.target.value)} placeholder="Search your country" required autoComplete="country-name" disabled={!!busy}/><datalist id="minime-countries">{COUNTRIES.map(c=><option key={c.code} value={c.name}/>)}</datalist></Field>
              <Field id="currency" label="Business currency"><select id="currency" className={styles.select} required value={draft.currency} onChange={e=>update({currency:e.target.value})} disabled={!!busy}><option value="">Choose currency</option>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></Field>
              <Field id="owner_name" label="Your name">{input('owner_name','text',{required:true,maxLength:100,autoComplete:'name'})}</Field>
              <div className={styles.badge}><LockKeyhole size={15}/>Private contact details · Not shared with customers</div>
              <Field id="owner_contact_email" label="Email address" optional>{input('owner_contact_email','email',{maxLength:254,autoComplete:'email'})}</Field>
              <Field id="owner_contact_phone" label="Phone number" optional>{input('owner_contact_phone','tel',{maxLength:32,autoComplete:'tel',inputMode:'tel'})}</Field>
              <p className={styles.hint}>{sessionBusiness?.trial_started_at ? `Your existing trial or plan continues${sessionBusiness.trial_ends_at ? `; trial end date: ${new Date(sessionBusiness.trial_ends_at).toLocaleDateString('en')}` : ''}.` : `${ONBOARDING_TRIAL.days} days free, starting when you activate. No payment card required.`}</p>
              <details className={styles.details}><summary>What happens after the trial?</summary><p>{ONBOARDING_TRIAL.afterTrial}</p><p>No automatic charge from this setup. You choose whether to upgrade.</p><a href="/legal/terms" target="_blank" rel="noreferrer">Read the terms</a></details>
              <div className={styles.trustNote} aria-label="Before you activate">
                <LockKeyhole size={16}/><span><strong>Before you activate:</strong> your private contact details stay private, and customers can only reach MiniMe through the link you receive next.</span>
              </div>
            </>}
            {screen === 'success' && <>
              <Field id="customer-link" label="Your customer link"><input id="customer-link" className={styles.input} value={customerLink} readOnly onFocus={e=>e.target.select()}/></Field>
              <button className={styles.secondary} type="button" onClick={()=>run('Copying…',async()=>{await navigator.clipboard.writeText(customerLink);setNotice('Customer link copied.');track('v2_link_copied');})} disabled={!!busy}><Copy size={17}/>Copy customer link</button>
              {!draft.knowledge && <p className={styles.hint} style={{marginTop:24}}>Next: add your business knowledge before inviting customers.</p>}
            </>}
          </form>
          {error && <div className={styles.error} role="alert">{error}</div>}
          {notice && <p className={styles.status} role="status"><CheckCheck size={18}/>{notice}</p>}
          {busy && <p className={styles.status} role="status">{busy}</p>}
        </>}
      </main>
    </div>
    {ready && <footer className={styles.footer}>
      {screen === 'review' && <p className={styles.note}>{sessionBusiness?.trial_started_at ? 'Your existing trial or plan continues.' : `${ONBOARDING_TRIAL.days} days free from activation · No card required.`}<br/>No automatic charge. After the trial, review and send replies on Free.</p>}
      {screen === 'business' && <p className={styles.note}>{ONBOARDING_TRIAL.days} days free from activation · No card required<br/>By continuing, you agree to the <a href="/legal/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="/legal/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>. MiniMe prepares replies from the information you choose.</p>}
      <button type="submit" form="minime-onboarding" className={styles.primary} disabled={inactive || editing}>{busy || label}{!busy && <ArrowRight size={18}/>}</button>
      {screen === 'offer' && <button type="button" className={`${styles.link} ${styles.skip}`} onClick={skipTeaching} disabled={!!busy}>Skip for now — add knowledge later</button>}
    </footer>}
  </div>;
}
