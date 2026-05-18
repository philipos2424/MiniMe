'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';

const INK   = '#0E2823';
const PAPER = '#FBF8F1';
const CREAM = '#F4EEE1';
const GOLD  = '#B08A4A';
const MINT  = '#4FA38A';
const LINE  = '#E4DED1';
const MUTED = '#8A9590';
const ERROR = '#B85450';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

const EXAMPLES = [
  { question: 'Do you deliver?', answer: 'Yes! We deliver within Addis Ababa. Delivery fee is 80 ETB to most areas.' },
  { question: 'What are your payment methods?', answer: 'We accept Chapa, CBE transfer, and Telebirr. Payment link sent after order.' },
  { question: 'Can I exchange or return?', answer: 'Yes — exchanges within 3 days of purchase if unused and with receipt.' },
  { question: 'What are your opening hours?', answer: 'We\'re open Monday–Saturday 9am–8pm, Sunday 11am–5pm.' },
];

export default function FAQPage() {
  const { business, setBusiness } = useTelegram() || {};
  const supabase = createClient();
  const [faqs, setFaqs] = useState([]);
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!business?.owner_instructions) return;
    setFaqs(business.owner_instructions.filter(r => r.source === 'faq' && r.question && r.answer));
  }, [business?.id]); // eslint-disable-line

  async function persist(updated) {
    if (!business?.id) return;
    setSaving(true);
    const nonFaq = (business.owner_instructions || []).filter(r => r.source !== 'faq');
    const next = [...nonFaq, ...updated.map(f => ({ source: 'faq', question: f.question, answer: f.answer, rule: `FAQ: "${f.question}" → "${f.answer.slice(0, 60)}"` }))];
    await supabase.from('businesses').update({ owner_instructions: next }).eq('id', business.id);
    setBusiness(b => ({ ...b, owner_instructions: next }));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function add() {
    if (!newQ.trim() || !newA.trim()) return;
    const updated = [...faqs, { question: newQ.trim(), answer: newA.trim() }];
    setFaqs(updated);
    setNewQ(''); setNewA('');
    await persist(updated);
  }

  async function remove(i) {
    const updated = faqs.filter((_, idx) => idx !== i);
    setFaqs(updated);
    await persist(updated);
  }

  const INPUT = {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 12px', borderRadius: 10,
    border: `1px solid ${LINE}`, background: '#fff',
    fontSize: 14, fontFamily: BODY, color: INK, outline: 'none',
  };

  return (
    <div style={{ fontFamily: BODY, color: INK, maxWidth: 560, paddingBottom: 40 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>
          FAQ Replies
        </div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          Instant answers
        </h1>
        <p style={{ fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.55 }}>
          Set up exact answers for common questions. When a customer asks one of these, Alfred uses your answer word-for-word — no AI improvisation.
        </p>
      </div>

      {/* Existing FAQs */}
      {faqs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {faqs.map((f, i) => (
            <div key={i} style={{
              background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: GOLD, letterSpacing: '0.06em', marginBottom: 4 }}>QUESTION</div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: INK, marginBottom: 8 }}>{f.question}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: MINT, letterSpacing: '0.06em', marginBottom: 4 }}>ALFRED'S EXACT ANSWER</div>
                  <div style={{ fontSize: 13.5, color: '#3A5250', lineHeight: 1.5 }}>{f.answer}</div>
                </div>
                <button onClick={() => remove(i)} style={{
                  border: 'none', background: 'none', cursor: 'pointer',
                  color: MUTED, fontSize: 18, lineHeight: 1, padding: '0 0 0 8px', flexShrink: 0,
                }}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {saved && <div style={{ color: MINT, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>✓ Saved</div>}

      {/* Add new FAQ */}
      <div style={{
        background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14, padding: '16px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Add a new Q&A</div>
        <div>
          <label style={{ fontSize: 12, color: MUTED, display: 'block', marginBottom: 5 }}>Question (what customers ask)</label>
          <input
            value={newQ}
            onChange={e => setNewQ(e.target.value)}
            placeholder="e.g. Do you deliver?"
            style={INPUT}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: MUTED, display: 'block', marginBottom: 5 }}>Alfred's exact answer</label>
          <textarea
            value={newA}
            onChange={e => setNewA(e.target.value)}
            placeholder="e.g. Yes! We deliver within Addis for 80 ETB. Order above 500 ETB gets free delivery."
            rows={3}
            style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>
        <button
          onClick={add}
          disabled={!newQ.trim() || !newA.trim() || saving}
          style={{
            background: newQ.trim() && newA.trim() ? INK : LINE,
            color: newQ.trim() && newA.trim() ? PAPER : MUTED,
            border: 'none', borderRadius: 999, padding: '12px',
            fontSize: 14, fontWeight: 600, cursor: newQ.trim() && newA.trim() ? 'pointer' : 'default',
            fontFamily: BODY,
          }}
        >
          {saving ? 'Saving…' : '+ Add FAQ reply'}
        </button>
      </div>

      {/* Examples */}
      {faqs.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
            Common examples — tap to use
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {EXAMPLES.map((e, i) => (
              <button key={i} onClick={() => { setNewQ(e.question); setNewA(e.answer); }} style={{
                background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12,
                padding: '12px 14px', textAlign: 'left', cursor: 'pointer', fontFamily: BODY,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 3 }}>{e.question}</div>
                <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.4 }}>{e.answer.slice(0, 80)}…</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
