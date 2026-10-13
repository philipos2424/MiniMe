'use client';

import { useState } from 'react';
import { useTelegram } from '../../../context/TelegramContext';
import TodayPanel from './TodayPanel';
import styles from './today.module.css';

export default function TodayPage() {
  const { initData, loading } = useTelegram() || {};
  const [revision, setRevision] = useState(0);
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>MINIME / PLATFORM ADMIN</p>
          <h1>Today</h1>
          <p className={styles.intro}>What needs your attention?</p>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => setRevision(r => r + 1)}>Refresh</button>
          <a href="/admin/legacy">Open legacy dashboard ↗</a>
          <button type="button" onClick={async () => {
            const response = await fetch('/api/admin/auth/logout', { method: 'POST' });
            if (response.ok) window.location.href = '/admin/login';
          }}>Sign out</button>
        </div>
      </header>
      <p className={styles.scope}>East Africa Time · Internal shops excluded · Refresh to check again</p>
      <div className={styles.grid}>
        {['freshness', 'payments', 'ai', 'webhooks', 'activity', 'signups'].map(panel => (
          <TodayPanel key={panel} panel={panel} initData={initData} ready={!loading} revision={revision} />
        ))}
      </div>
      <footer className={styles.footer}>
        Payment review, bot diagnostics and all existing tools remain available in the legacy dashboard.
      </footer>
    </main>
  );
}
