'use client';

import Link from 'next/link';
import { Home, MessageSquare, Sparkles, BarChart2, Settings, Package, BookOpen, Users, ArrowLeft, Moon, Sun, LogOut, ArrowUpRight } from 'lucide-react';
import styles from './WorkspaceFrame.module.css';

const primary = [
  ['/', Home, 'Home', 'home'],
  ['/conversations', MessageSquare, 'Chats', 'chats'],
  ['/advisor', Sparkles, 'MiniMe', 'minime'],
  ['/progress', BarChart2, 'Progress', 'progress'],
  ['/settings', Settings, 'Settings', 'settings'],
];
const workspace = [
  ['/products', Package, 'Products'],
  ['/teach', BookOpen, 'Knowledge'],
  ['/customers', Users, 'Customers'],
];

export default function WorkspaceFrame({ children, business, pathname = '/', pendingCount = 0, dark, onTheme, onBack, onSignOut, onNavigate }) {
  const active = href => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  const current = [...primary, ...workspace].find(([href]) => active(href));
  const title = current?.[2] || 'Workspace';
  const showBack = !primary.some(([href]) => href === pathname);
  function navItem([href, Icon, label, intent], mobile = false) {
    const selected = active(href);
    return <Link key={href} href={href} onClick={onNavigate} aria-current={selected ? 'page' : undefined}
      data-intent={intent ? `nav.tab.${intent}` : `nav.workspace.${label.toLowerCase()}`}
      className={`${styles.navItem} ${selected ? styles.selected : ''} ${mobile && href === '/advisor' ? styles.agentTab : ''}`}>
      <span className={styles.navIcon}><Icon size={20} strokeWidth={selected ? 2 : 1.7} />
        {href === '/conversations' && pendingCount > 0 && <span className={styles.badge} aria-label={`${pendingCount} pending conversations`}>{pendingCount > 99 ? '99+' : pendingCount}</span>}
      </span><span>{label}</span>
    </Link>;
  }

  return <div className={styles.frame}>
    <a className={styles.skip} href="#workspace-content">Skip to content</a>
    <aside className={styles.sidebar}>
      <Link href="/" onClick={onNavigate} className={styles.brand}><span><Sparkles size={22} /></span>minime<span className={styles.brandDot}>.</span></Link>
      <div className={styles.business}><span className={styles.avatar}>{business?.name?.slice(0, 1).toUpperCase() || 'M'}</span><div><strong>{business?.name || 'Your business'}</strong><small>Business workspace</small></div></div>
      <nav aria-label="Main navigation" className={styles.primaryNav}>{primary.map(item => navItem(item))}</nav>
      <p className={styles.groupLabel}>WORKSPACE</p>
      <nav aria-label="Business tools" className={styles.primaryNav}>{workspace.map(item => navItem(item))}</nav>
      <div className={styles.sidebarBottom}><p>A little help.<br/>A lot more possibility.</p><Link href="/teach" onClick={onNavigate}>Make MiniMe yours <ArrowUpRight size={16} /></Link></div>
    </aside>

    <div className={styles.column}>
      <header className={styles.header}>
        {showBack && <button className={`${styles.iconButton} ${styles.back}`} onClick={onBack} aria-label="Go back"><ArrowLeft size={20}/></button>}
        <div className={styles.headerTitle}><span className={styles.desktopTitle}>{title}</span><span className={styles.mobileTitle}>{business?.name || 'MiniMe'}</span><small className={styles.mobileTitle}>Your business workspace</small></div>
        <div className={`${styles.status} ${business?.panic_mode ? styles.paused : ''}`}><span/>{business?.panic_mode ? 'Paused' : 'Enabled'}</div>
        <button className={styles.iconButton} onClick={onTheme} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>{dark ? <Sun size={19}/> : <Moon size={19}/>}</button>
        {onSignOut && <button className={`${styles.iconButton} ${styles.signOut}`} onClick={onSignOut} aria-label="Sign out"><LogOut size={18}/></button>}
      </header>
      <main id="workspace-content" tabIndex={-1} className={styles.content}>{children}</main>
      <nav className={styles.mobileNav} aria-label="Main navigation">{primary.map(item => navItem(item, true))}</nav>
    </div>
  </div>;
}
