/**
 * Job detector — decides whether a customer message describes a multi-step
 * project the Agent should orchestrate (designer → printer → delivery, etc.)
 * rather than a simple product order or info question.
 *
 * Returns structured JSON so we can create a `jobs` row with steps ready to go.
 */
import OpenAI from 'openai';
import { MODEL } from './constants';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

// Cheap pre-filter — most messages are trivially NOT jobs.
// Short greetings, price questions, single-product orders → skip the LLM call.
function couldBeJob(text) {
  if (!text || text.length < 40) return false;
  // Must mention quantities, deadlines, events, or multiple item types.
  const signals = [
    /\b\d+\s*(pcs|pieces|items|copies|units|cards|banners|programs|shirts|mugs|posters|flyers|brochures|tables)\b/i,
    /\b(event|gala|wedding|conference|launch|ceremony|opening|exhibition|fundraiser)\b/i,
    /\b(by|before|on|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|friday|weekend)\b/i,
    /\b(design\s*and\s*print|print\s*and\s*deliver|branded materials|full package|turnkey)\b/i,
    /\b(deadline|budget|ASAP|urgent)\b/i,
    /\d+\s*(ETB|birr|USD|\$)/i,
  ];
  // Need at least 2 distinct signals → probably a multi-step request
  let hits = 0;
  for (const rx of signals) if (rx.test(text)) hits++;
  return hits >= 2;
}

const SYSTEM = `You are a job detector for a small-business AI assistant.
Decide whether the customer message describes a MULTI-STEP PROJECT the owner would orchestrate across multiple suppliers (designer, printer, delivery, catering, installer, etc.) — NOT a simple retail order or info question.

Examples of JOBS (return is_job:true):
- "We need 200 programs, 50 table cards, 10 banners for our gala on Friday. Budget 45,000 ETB."
- "Can you design and print business cards for our whole team (15 people) by next week?"
- "Our wedding is on the 20th. Need invitations, signage, and seating charts."

Examples of NOT-JOBS (is_job:false):
- "How much is this product?" — price question
- "Do you deliver to Bole?" — info question
- "I'll take 2 cards please" — simple order
- "Hi, are you there?" — greeting

If the message clearly describes a multi-step project but is missing critical info (no quantity, no deadline, or no budget), set is_job:true but also set clarifying_question to a single short question the agent should ask the customer first. Otherwise clarifying_question:null.

Return ONLY JSON with this shape:
{
  "is_job": boolean,
  "confidence": 0..1,
  "title": "short 3-6 word title",
  "description": "1-2 sentence summary of what they need",
  "deadline_hint": "ISO date string or null",
  "budget_hint": number or null,
  "currency": "ETB" | "USD" | null,
  "clarifying_question": "string or null — a single short question to ask if critical info is missing",
  "missing": ["quantity" | "deadline" | "budget" | "deliverables"],
  "items": [{"label": "200 programs", "role": "printer"}, ...],
  "steps": [
    {"label": "Acknowledge client", "icon": "📥", "role": "agent", "auto": true},
    {"label": "Brief designer", "icon": "🎨", "role": "designer", "auto": true},
    {"label": "Client approves design", "icon": "👁️", "role": "client", "auto": false},
    {"label": "Send to printer", "icon": "🖨️", "role": "printer", "auto": true},
    {"label": "Arrange delivery", "icon": "🚚", "role": "delivery", "auto": true},
    {"label": "Notify client complete", "icon": "🎉", "role": "client", "auto": true}
  ]
}

Adjust the step list to what the specific job needs. Keep step labels short.`;

export async function detectJob(text, context = {}) {
  if (!couldBeJob(text)) return { is_job: false };

  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 800,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content:
`Business: ${context.businessName || 'Small business'} (${context.category || 'general'})
Customer message:
"""
${text}
"""

Return JSON only.` },
      ],
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    if (!parsed.is_job || (parsed.confidence ?? 0) < 0.6) return { is_job: false };
    return parsed;
  } catch (e) {
    console.warn('detectJob:', e.message);
    return { is_job: false };
  }
}
