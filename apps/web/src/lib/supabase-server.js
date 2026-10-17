import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Async since Next 15: cookies() returns a promise.
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (process.env.NODE_ENV === 'production') return null;
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY missing');
  }

  const cookieStore = await cookies();
  return createServerClient(
    url,
    key,
    {
      // getAll/setAll is the cookie API @supabase/ssr supports since 0.5; the
      // old get/set/remove trio is deprecated.
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components can't set cookies; only route handlers and
            // server actions can. Nothing to persist from a render.
          }
        },
      },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    }
  );
}
