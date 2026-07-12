'use client';
/**
 * Shared Market helpers — palette, categories, Telegram plumbing, and the
 * voice-search state machine. Client-side only (the Market is a public
 * Mini App that reads window.Telegram directly).
 */
import { useEffect, useRef, useState } from 'react';

export const INK = '#0E2823';
export const PAPER = '#FBF8F1';
export const CREAM = '#F4EEE1';
export const LINE = '#E4DED1';
export const MUTED = '#8A9590';
export const TEAL = '#4FA38A';
export const GOLD = '#B08A4A';
export const SERIF = "'Newsreader', 'Fraunces', Georgia, serif";
export const BODY = "'Geist', 'Noto Sans Ethiopic', -apple-system, system-ui, sans-serif";

export const CATEGORIES = [
  ['', 'All'],
  ['electronics_phones', '📱 Electronics'],
  ['food_beverage', '☕ Food & Cafés'],
  ['catering_food', '🍽️ Catering'],
  ['clothing_fashion', '👗 Fashion'],
  ['beauty_wellness', '💆 Beauty'],
  ['branding_design', '🎨 Design'],
  ['printing_signage', '🖨️ Printing'],
  ['photography_video', '📸 Photo'],
  ['events_entertainment', '🎉 Events'],
  ['construction_interior', '🏗️ Construction'],
  ['it_tech', '💻 Tech'],
  ['transport_delivery', '🚚 Delivery'],
  ['training_consulting', '📋 Training'],
  ['wholesale_supply', '📦 Wholesale'],
];

export const SORTS = [
  ['newest', 'Newest'],
  ['price_asc', 'Price ↑'],
  ['price_desc', 'Price ↓'],
  ['rating', 'Top rated'],
];

export const WEB_BASE = process.env.NEXT_PUBLIC_WEB_URL || 'https://web-theta-one-68.vercel.app';

export function tgUserId() {
  try { return String(window?.Telegram?.WebApp?.initDataUnsafe?.user?.id || '') || null; } catch { return null; }
}

export function tgInitData() {
  try { return window?.Telegram?.WebApp?.initData || ''; } catch { return ''; }
}

export function logEvent(event_type, extra = {}) {
  try {
    fetch('/api/market/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type, tg_user_id: tgUserId(), ...extra }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function openChat(url) {
  try {
    const twa = window?.Telegram?.WebApp;
    if (twa?.openTelegramLink) { twa.openTelegramLink(url); return; }
  } catch {}
  window.open(url, '_blank');
}

export function fmtPrice(p, cur) {
  if (p == null) return '';
  return `${Number(p).toLocaleString()} ${cur || 'ETB'}`;
}

/** t.me share screen for a product or shop deep link into the Market. */
export function shareLink({ product, shop, text }) {
  const url = product
    ? `${WEB_BASE}/market?product=${product.id}`
    : `${WEB_BASE}/market?shop=${shop.id}`;
  const label = text || (product
    ? `${product.name}${product.price != null ? ` — ${fmtPrice(product.price, product.currency)}` : ''} on MiniMe Market`
    : `${shop.name} on MiniMe Market`);
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(label)}`;
}

/** 🎙️ Voice search — record with MediaRecorder, upload to Whisper, hand the
 *  transcript to onResult. Extracted from the old inline page logic. */
export function useVoiceSearch(onResult) {
  const [voiceState, setVoiceState] = useState('idle'); // idle | recording | transcribing | error
  const [voiceErr, setVoiceErr] = useState('');
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timeoutRef = useRef(null);

  // Stop any in-flight recording if the page unmounts mid-capture.
  useEffect(() => () => {
    clearTimeout(timeoutRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch {}
    }
  }, []);

  function stopVoice() {
    clearTimeout(timeoutRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  }

  async function transcribe(blob) {
    setVoiceState('transcribing');
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'search.webm');
      const r = await fetch('/api/market/voice-search', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok || !j.text) throw new Error(j.error || "Couldn't catch that");
      setVoiceState('idle');
      onResult(j.text);
    } catch (e) {
      setVoiceState('error'); setVoiceErr(e.message || 'Transcription failed — try typing instead.');
    }
  }

  async function startVoice() {
    if (voiceState === 'recording') { stopVoice(); return; }
    setVoiceErr('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceState('error'); setVoiceErr('Voice search needs microphone support — try typing instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        clearTimeout(timeoutRef.current);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        transcribe(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setVoiceState('recording');
      timeoutRef.current = setTimeout(() => stopVoice(), 10000); // auto-stop at 10s
    } catch {
      setVoiceState('error'); setVoiceErr('Microphone access denied — try typing instead.');
    }
  }

  return { voiceState, voiceErr, startVoice };
}
