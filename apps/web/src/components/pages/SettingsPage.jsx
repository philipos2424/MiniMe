'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import Link from 'next/link';
import { Mic, Shield, CreditCard, ChevronRight, Bot } from 'lucide-react';
import PageHeader from '../ui/PageHeader';
import { useToast } from '../ui/Toast';
import { useLanguage } from '../../context/LanguageContext';

export default function SettingsPage() {
  const { business: tgBusiness } = useTelegram();
  const supabase = createClient();
  const { toast } = useToast();
  const { showAmharic, setShowAmharic } = useLanguage();
  const [business, setBusiness] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tgBusiness) setBusiness(tgBusiness);
  }, [tgBusiness]);

  async function save() {
    if (!business) return;
    setSaving(true);
    const { error } = await supabase
      .from('businesses')
      .update({
        name: business.name,
        category: business.category,
        location: business.location,
        owner_name: business.owner_name,
      })
      .eq('id', business.id);
    setSaving(false);
    if (error) toast('Could not save changes.', { variant: 'error' });
    else toast('Profile updated.', { variant: 'success' });
  }

  const sections = [
    { href: '/settings/bot', icon: Bot, label: 'Your Bot', desc: 'Connect your own Telegram bot', descAm: 'ቦት ያገናኙ' },
    { href: '/settings/voice', icon: Mic, label: 'Voice & Style', desc: 'Train MiniMe to sound like you' },
    { href: '/settings/trust', icon: Shield, label: 'Trust Controls', desc: 'Manage AI autonomy levels' },
    { href: '/settings/billing', icon: CreditCard, label: 'Billing', desc: 'Subscription and payments' },
  ];

  return (
    <div className="space-y-6 max-w-xl">
      <PageHeader
        title="Settings"
        subtitleAm="ቅንብር"
        subtitleEn="Tune how MiniMe works for your business"
      />

      {/* Language toggle — Amharic off by default (international product) */}
      <div className="flex items-center justify-between bg-card border border-border rounded-xl p-4">
        <div>
          <p className="text-gold-light font-medium">Show Amharic labels</p>
          <p className="text-muted text-xs mt-0.5">Adds ፊደል next to English throughout the app.</p>
        </div>
        <button
          onClick={() => setShowAmharic(!showAmharic)}
          role="switch"
          aria-checked={showAmharic}
          className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition ${showAmharic ? 'bg-gold' : 'bg-border'}`}
        >
          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${showAmharic ? 'translate-x-5' : 'translate-x-0.5'} mt-0.5`} />
        </button>
      </div>

      {business && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-gold-light font-semibold">Business Profile</h2>
          {[
            ['Business Name', 'name'],
            ['Category', 'category'],
            ['Location', 'location'],
            ['Your Name', 'owner_name'],
          ].map(([label, key]) => (
            <div key={key}>
              <label className="text-muted text-sm block mb-1">{label}</label>
              <input
                value={business[key] || ''}
                onChange={e => setBusiness(p => ({ ...p, [key]: e.target.value }))}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2.5 min-h-[44px] text-body focus:outline-none focus:border-gold"
              />
            </div>
          ))}
          <button
            onClick={save}
            disabled={saving}
            className="bg-gold text-bg font-semibold px-4 py-2.5 min-h-[44px] rounded-lg hover:bg-gold-light transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
      <div className="space-y-2">
        {sections.map(({ href, icon: Icon, label, desc, descAm }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-4 bg-card border border-border rounded-xl p-4 min-h-[44px] hover:border-gold/40 transition"
          >
            <Icon className="text-gold shrink-0" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-gold-light font-medium">{label}</p>
              <p className="text-muted text-sm">
                {desc}
                {descAm && <><span className="am-sep"> · </span><span className="am">{descAm}</span></>}
              </p>
            </div>
            <ChevronRight size={18} className="text-muted shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
