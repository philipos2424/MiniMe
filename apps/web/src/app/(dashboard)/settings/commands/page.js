'use client';
import { useTelegram } from '../../../../context/TelegramContext';

const INK   = '#0E2823';
const PAPER = '#FBF8F1';
const CREAM = '#F4EEE1';
const GOLD  = '#B08A4A';
const MINT  = '#4FA38A';
const LINE  = '#E4DED1';
const MUTED = '#8A9590';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const MONO  = "'Geist Mono', ui-monospace, monospace";

const SECTIONS = [
  {
    title: 'Check your business',
    icon: '📊',
    commands: [
      { cmd: '/orders',    desc: 'See all pending orders and active jobs. Tap to update status or DM the customer.' },
      { cmd: '/sales',     desc: 'Revenue summary — today, this week, this month. Shows paid orders.' },
      { cmd: '/stock',     desc: 'Inventory levels. Highlights out-of-stock and low-stock products.' },
      { cmd: '/customers', desc: 'List your customers with their order history and loyalty tier.' },
    ],
  },
  {
    title: 'Update your catalog',
    icon: '✏️',
    commands: [
      { cmd: '/add Injera 45',              desc: 'Add a NEW product instantly. MiniMe will start selling it right away.' },
      { cmd: '/add Tibs 180 50',            desc: 'Add a product with stock: name, price, quantity. All in one command.' },
      { cmd: '/remove Injera',              desc: 'Hide a product from your catalog (deactivate). Use /add to restore it.' },
      { cmd: '/price Injera 18',            desc: 'Update the price of an existing product.' },
      { cmd: '/restock Injera +50',         desc: 'Add stock quantity. Use a number to set absolute: /restock Bag 100' },
      { cmd: '/restock Bag 0',              desc: 'Set to 0 to mark as out of stock. MiniMe will stop suggesting it.' },
    ],
  },
  {
    title: 'Message customers',
    icon: '💬',
    commands: [
      { cmd: '/dm Sara your order is ready', desc: 'Send a direct message to a customer by name. Works with first name.' },
      { cmd: '/dm @username thanks!',        desc: 'DM by Telegram username.' },
    ],
  },
  {
    title: 'Search products',
    icon: '🔍',
    commands: [
      { cmd: '/search leather bag', desc: 'Instantly search your catalog. Shows name, price, and stock. Use it to find a product before updating its price or stock.' },
    ],
  },
  {
    title: 'Teach MiniMe',
    icon: '🧠',
    commands: [
      { cmd: '/teach We close on Sundays', desc: 'Teach MiniMe a new fact directly from the bot. It embeds it immediately.' },
      { cmd: '/rule always mention free delivery for orders above 500 birr', desc: 'Add a behavior rule. MiniMe will follow it in every reply.' },
      { cmd: '/rules',  desc: 'List all your current behavior rules.' },
      { cmd: '/knowledge', desc: 'View all knowledge items MiniMe has learned. Tap any to delete it.' },
      { cmd: '/forget Menu PDF', desc: 'Delete a specific knowledge item by title.' },
    ],
  },
  {
    title: 'Discounts & promo codes',
    icon: '🏷️',
    commands: [
      { cmd: '/discount SUMMER20 20%', desc: 'Create a 20% off promo code. Customers type it during checkout — MiniMe applies it automatically.' },
      { cmd: '/discount FRIENDS 50 fixed', desc: 'Create a fixed 50 ETB off discount.' },
      { cmd: '/discount SAVE10 10% expires:2025-12-31', desc: 'Create a code that expires on a specific date.' },
    ],
  },
  {
    title: 'Reminders',
    icon: '⏰',
    commands: [
      { cmd: '/reminders', desc: 'See all your pending reminders.' },
      { cmd: 'Remind me to restock bags tomorrow 9am', desc: 'Just type it naturally — MiniMe understands and sets the reminder.' },
    ],
  },
  {
    title: 'Ask the Advisor',
    icon: '🤔',
    commands: [
      { cmd: '/advisor', desc: 'Ask anything about your business. "Which customer spent the most this week?" "What should I focus on today?"' },
      { cmd: 'How is my shop doing?', desc: 'You can also just ask naturally — MiniMe will route advisor-type questions automatically.' },
    ],
  },
  {
    title: 'Customer commands (your customers can use these)',
    icon: '👤',
    commands: [
      { cmd: '/status', desc: 'Your customer types this to check the status of their most recent order — shows item, total, and current status.' },
      { cmd: '/catalog', desc: 'Shows your full product list with prices inline in the chat.' },
      { cmd: '/myorders', desc: 'Shows a customer\'s last 5 orders at your shop.' },
      { cmd: '/loyalty', desc: 'Shows a customer their loyalty points, tier (Bronze/Silver/Gold), and progress.' },
    ],
  },
];

function CmdCard({ cmd, desc }) {
  return (
    <div style={{
      background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12,
      padding: '12px 14px', marginBottom: 8,
    }}>
      <code style={{
        display: 'inline-block', fontFamily: MONO, fontSize: 12.5, fontWeight: 700,
        color: GOLD, background: 'rgba(176,138,74,0.1)',
        padding: '3px 8px', borderRadius: 6, marginBottom: 6, wordBreak: 'break-all',
      }}>{cmd}</code>
      <div style={{ fontSize: 13, color: '#3A5250', lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

export default function CommandsPage() {
  const { business } = useTelegram() || {};
  const botName = business?.telegram_bot_username;
  // Shared-mode owners message @MiniMeAgentBot to use commands
  const ownerBotUrl = botName
    ? `https://t.me/${botName}`
    : 'https://t.me/MiniMeAgentBot';
  const ownerBotLabel = botName ? `@${botName}` : '@MiniMeAgentBot';

  return (
    <div style={{ fontFamily: BODY, color: INK, maxWidth: 560, paddingBottom: 40 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>
          Bot Commands
        </div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          How to use your bot
        </h1>
        <p style={{ fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.55 }}>
          Open <strong>{ownerBotLabel}</strong> in Telegram and send any of these commands. You can also type naturally — MiniMe understands plain language.
        </p>
      </div>

      {/* Quick start tip */}
      <div style={{
        background: 'rgba(79,163,138,0.08)', border: '1px solid rgba(79,163,138,0.25)',
        borderRadius: 14, padding: '14px 16px', marginBottom: 24,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: MINT, marginBottom: 6 }}>💡 Quick tip</div>
        <div style={{ fontSize: 13, color: '#2A5A4A', lineHeight: 1.55 }}>
          You can type anything naturally to your bot — not just slash commands.
          Try: <em>"How many orders did I get this week?"</em> or <em>"DM Sara her order is ready"</em> or <em>"Restock bags by 20"</em>.
          MiniMe understands plain Amharic and English too.
        </div>
      </div>

      {/* Bot link */}
      <a
        href={ownerBotUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: INK, color: '#fff', borderRadius: 999, padding: '13px 0',
          textDecoration: 'none', fontSize: 14, fontWeight: 600, marginBottom: 24,
        }}
      >
        Open {ownerBotLabel} →
      </a>

      {/* Command sections */}
      {SECTIONS.map(s => (
        <div key={s.title} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 18 }}>{s.icon}</span>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>
              {s.title}
            </div>
          </div>
          {s.commands.map(c => <CmdCard key={c.cmd} {...c} />)}
        </div>
      ))}

      {/* Forwarding tip */}
      <div style={{
        background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 16px', marginTop: 8,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 6 }}>📸 Forward photos to update stock</div>
        <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.55 }}>
          Forward a supplier invoice, price list, or product photo to your bot with the caption{' '}
          <code style={{ background: '#fff', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>update stock</code> or{' '}
          <code style={{ background: '#fff', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>new prices</code>{' '}
          — MiniMe will read the photo and apply the changes automatically.
        </div>
      </div>
    </div>
  );
}
