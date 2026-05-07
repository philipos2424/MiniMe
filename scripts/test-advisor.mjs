// Test the Advisor end-to-end against the live KB we just taught.
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.test', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '').replace(/\\n$/, '')]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const { data: bs } = await sb.from('businesses').select('*').limit(1);
const business = bs[0];
console.log('Business:', business.name, '·', business.category || '—');

// Replicate getAdvisorContext (simplified)
const { data: customers } = await sb.from('customers').select('id, name, telegram_username, sentiment_avg, total_spent, last_active_at').eq('business_id', business.id).limit(20);
const { data: jobs } = await sb.from('jobs').select('id, title, status, current_step, budget, currency, deadline, customer_id').eq('business_id', business.id).in('status', ['draft', 'active', 'awaiting_approval', 'blocked']);
const { data: docs } = await sb.from('documents').select('title, tag, description').eq('business_id', business.id);

const clients = (customers || []).map(c => ({
  name: c.name || c.telegram_username || '(unknown)',
  mood: c.sentiment_avg == null ? null : Math.max(1, Math.min(10, Math.round(c.sentiment_avg * 10))),
  spent: c.total_spent || 0,
  last_seen: c.last_active_at,
}));

const clientsBlock = clients.slice(0, 10).map(c => `- ${c.name} · mood ${c.mood ?? '?'}/10 · ${c.spent} ETB lifetime`).join('\n') || '(no clients)';
const docsBlock = (docs || []).map(d => `- [${d.tag}] ${d.title} — ${(d.description || '').slice(0, 200)}`).join('\n') || '(none)';
const jobsBlock = (jobs || []).map(j => `- "${j.title}" · ${j.status} · ${j.budget || '?'} ${j.currency || 'ETB'}`).join('\n') || '(no active jobs)';

const system = `You are the personal business advisor for ${business.name}.
HARD RULES: name specific clients, quote exact ETB, give ONE clear next action, under 250 words, lead with the most urgent thing. Use emojis: ⚠️ 💰 😟 ✅ 📈 ⚡ ⭐. If the owner asks in Amharic, reply in Ethiopic script.

End with: ACTIONS: [{...}] (or [])

## CLIENTS
${clientsBlock}

## ACTIVE JOBS
${jobsBlock}

## KNOWLEDGE TAUGHT BY OWNER
${docsBlock}
`;

const QUESTIONS = [
  'What should I focus on today?',
  'Which deals am I losing?',
  'How is my response time?',
  'ዛሬ ምን ማድረግ አለብኝ?',
  'Who are my happiest clients?',
  'What can the agent handle for me?',
];

for (const q of QUESTIONS) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Q:', q);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const r = await openai.chat.completions.create({
    model: 'gpt-4o', temperature: 0.6, max_tokens: 600,
    messages: [{ role: 'system', content: system }, { role: 'user', content: q }],
  });
  console.log(r.choices[0].message.content);
}
