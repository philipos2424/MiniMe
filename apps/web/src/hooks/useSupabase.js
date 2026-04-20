'use client';
import { createClient } from '../lib/supabase-browser';

let client;
export function useSupabase() {
  if (!client) client = createClient();
  return client;
}
