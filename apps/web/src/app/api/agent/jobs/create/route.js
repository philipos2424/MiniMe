/**
 * POST /api/agent/jobs/create — owner manually creates a job from the dashboard.
 *
 * Body: { title, description?, deadline?, budget?, currency?, clientName?, clientContact?, steps? }
 * If steps not provided, uses a sensible default pipeline.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { createJob, logEvent } from '../../../../../lib/server/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_STEPS = [
  { label: 'Acknowledge client',     icon: '📥', role: 'agent',    auto: true },
  { label: 'Brief designer',         icon: '🎨', role: 'designer', auto: true },
  { label: 'Client approves design', icon: '👁️', role: 'client',   auto: false },
  { label: 'Send to printer',        icon: '🖨️', role: 'printer',  auto: true },
  { label: 'Arrange delivery',       icon: '🚚', role: 'delivery', auto: true },
  { label: 'Notify client complete', icon: '🎉', role: 'client',   auto: true },
];

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'no business' }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const title = (body.title || '').trim();
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

  const steps = Array.isArray(body.steps) && body.steps.length ? body.steps : DEFAULT_STEPS;

  const job = await createJob({
    businessId: business.id,
    title,
    description: body.description || null,
    deadline: body.deadline || null,
    budget: body.budget ? Number(body.budget) : null,
    currency: body.currency || 'ETB',
    steps,
    clientSnapshot: {
      name: body.clientName || null,
      contact: body.clientContact || null,
    },
  });

  if (!job) return NextResponse.json({ error: 'create failed' }, { status: 500 });

  await logEvent(job.id, {
    kind: 'manual_created', icon: '✍️', title: 'Job created manually',
    body: 'Owner added this job from the dashboard.', auto: false, color: 'blue',
  });

  return NextResponse.json({ job });
}
