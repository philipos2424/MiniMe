'use client';
import Link from 'next/link';
import { ArrowUpRight, ArrowRight, MessageSquare, Package, CreditCard, Check, Sparkles, BookOpen, Users, SlidersHorizontal, AlertCircle } from 'lucide-react';
import styles from './HomeOverview.module.css';

export default function HomeOverview({ business, feed, error, onRetry, onFeedback }) {
  const loading = !feed && !error;
  const priorities = [
    { count: feed?.owner_attention_count ?? feed?.needs_reply?.length ?? 0, title: 'Customers waiting for you', detail: 'Review conversations that need your attention.', href: '/conversations', icon: MessageSquare },
    { count: feed?.ready_to_fulfill_count || 0, title: 'Orders ready to prepare', detail: 'Payment received. Take the next step.', href: '/orders?status=paid', icon: Package },
    { count: feed?.pending_payment_count || 0, title: 'Payments to follow up', detail: 'Keep your open orders moving.', href: '/orders?status=pending_payment', icon: CreditCard },
    { count: (feed?.low_stock_count || 0) + (feed?.out_of_stock_count || 0), title: 'Products need a stock update', detail: 'Keep availability accurate for your customers.', href: '/products', icon: Package },
  ].filter(item => item.count > 0);
  const currency = feed?.revenue_currency || business?.currency || 'ETB';
  let revenue = '—';
  if (feed) {
    try { revenue = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(feed.revenue_today ?? 0); }
    catch { revenue = `${feed.revenue_today ?? 0} ${currency}`; }
  }
  return <div className={styles.home}>
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>YOUR BUSINESS, AT A GLANCE</p><h1>A little more headspace.</h1><p>Your customers, your next steps, and MiniMe by your side.</p></div>
      <Link href="/advisor" data-intent="home.ask.open" className={styles.primary}><Sparkles size={18} /> Ask MiniMe <ArrowUpRight size={17} /></Link>
    </header>

    {error && <div role="alert" className={styles.error}><AlertCircle size={18} /><span>{feed ? 'Activity may be out of date.' : 'We couldn’t load your activity.'}</span><button onClick={onRetry}>Try again</button></div>}

    <div className={styles.layout}>
      <div className={styles.main}>
        <section className={styles.priorities} aria-labelledby="priorities-title" aria-busy={loading}>
          <div className={styles.sectionHead}><div><p className={styles.eyebrow}>START HERE</p><h2 id="priorities-title">Your next best move</h2></div><span className={styles.counter}>{feed ? priorities.length : '—'}</span></div>
          {loading ? <div className={styles.empty} role="status"><span className={styles.skeleton} /><p>Loading your priorities…</p></div> : !feed ? <div className={styles.empty}><p>Your priorities will appear when activity is available.</p></div> : priorities.length ? <div>{priorities.map(({ title, detail, count, href, icon: Icon }) => <Link className={styles.action} data-intent={`home.priority.${href.split('/')[1].split('?')[0]}`} href={href} key={href}><span className={styles.icon}><Icon size={20}/></span><span className={styles.actionText}><strong>{title}</strong><small>{detail}</small></span><span className={styles.count}>{count}</span><ArrowUpRight size={18}/></Link>)}</div> : <div className={styles.empty}><span className={styles.done}><Check size={25}/></span><h3>{feed.has_any_messages ? 'You’re all caught up.' : 'Ready for your first conversation.'}</h3><p>{feed.has_any_messages ? 'No customer replies, payments, or stock updates need your attention right now.' : 'Teach MiniMe about your business, then invite a customer to start a conversation.'}</p><Link href={feed.has_any_messages ? '/conversations' : '/teach'}>{feed.has_any_messages ? 'View conversations' : 'Teach MiniMe'} <ArrowRight size={16}/></Link></div>}
          <div className={styles.cardFooter}><span className={styles.dot}/>{business?.panic_mode ? 'Automation is paused' : 'Automation is enabled'}<Link href="/agent">Manage agent <ArrowRight size={14}/></Link></div>
        </section>

        <section className={styles.activity} aria-labelledby="activity-title">
          <div className={styles.sectionHead}><h2 id="activity-title">Today, in numbers</h2><Link href="/analytics">View analytics <ArrowUpRight size={15}/></Link></div>
          <div className={styles.metrics}>{[
            ['AI replies', feed ? feed.handled_today ?? 0 : '—'],
            ['Paid orders', feed ? feed.orders_today ?? 0 : '—'],
            ['Revenue', revenue],
          ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
          <p className={styles.caption}>{feed ? 'Recorded today · East Africa Time (UTC+3).' : 'Waiting for activity data. Numbers are not available yet.'}</p>
        </section>

        <section className={styles.workspace} aria-labelledby="workspace-title"><div className={styles.sectionHead}><h2 id="workspace-title">Your workspace</h2></div><div className={styles.tools}>{[
          ['/products', Package, 'Products', 'Catalog & availability'], ['/customers', Users, 'Customers', 'People behind the chats'], ['/teach', BookOpen, 'Knowledge', 'What MiniMe should know'], ['/settings', SlidersHorizontal, 'Settings', 'Make it work your way'],
        ].map(([href, Icon, title, description]) => <Link href={href} data-intent={`home.workspace.${title.toLowerCase()}`} key={href}><Icon size={21}/><strong>{title}</strong><span>{description}</span><ArrowUpRight size={16} className={styles.toolArrow}/></Link>)}</div></section>
      </div>

      <aside className={styles.aside}>
        <section className={styles.assistant}><div className={styles.orb}><Sparkles size={28}/></div><p className={styles.eyebrow}>MEET YOUR SECOND PAIR OF HANDS</p><h2>A thought.<br/>{' '}A question.<br/>{' '}<em>A next step.</em></h2><p>Talk it through with MiniMe. Get help with your business, right from here.</p><Link href="/advisor">Let’s talk <ArrowUpRight size={18}/></Link><span className={styles.assistantNote}>Your business context. One conversation.</span></section>
        <section className={styles.knowledge}><BookOpen size={22}/><h3>Better knowledge.<br/>Better answers.</h3><p>Add your prices, delivery details, and FAQs so MiniMe has the facts it needs.</p><Link href="/teach" data-intent="home.knowledge.open">Teach MiniMe <ArrowRight size={16}/></Link></section>
      </aside>
    </div>
    <footer className={styles.footer}><span>Built around your working day.</span><button data-intent="home.feedback.open" onClick={onFeedback}>Share feedback <ArrowUpRight size={14}/></button></footer>
  </div>;
}
