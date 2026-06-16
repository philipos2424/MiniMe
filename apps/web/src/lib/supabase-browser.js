'use client';
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (process.env.NODE_ENV === 'production') return null;
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY missing');
  }

  return createBrowserClient(url, key);
}
