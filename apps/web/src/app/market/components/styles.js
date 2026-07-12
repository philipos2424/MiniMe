/**
 * The Market's scoped stylesheet (.mk). One string, injected once by page.js.
 * Same cream/teal/gold identity as before the component split — new classes
 * (hearts, tabs, filter bar, shop view, reviews) extend it, never restyle it.
 */
import { INK, PAPER, CREAM, LINE, MUTED, TEAL, GOLD, SERIF, BODY } from '../lib';

export const MARKET_CSS = `
  .mk { min-height: 100vh; background: ${PAPER}; color: ${INK}; font-family: ${BODY};
        background-image: radial-gradient(1200px 400px at 50% -200px, rgba(79,163,138,0.07), transparent); }
  .mk * { box-sizing: border-box; }
  .mk-head { position: sticky; top: 0; z-index: 20; background: rgba(251,248,241,0.92);
             backdrop-filter: blur(10px); border-bottom: 1px solid ${LINE}; padding: 14px 16px 10px; }
  .mk-title { font-family: ${SERIF}; font-size: 24px; font-weight: 500; letter-spacing: -0.02em; margin: 0; }
  .mk-sub { font-size: 12px; color: ${MUTED}; margin: 2px 0 10px; }
  .mk-search { display: flex; align-items: center; gap: 8px; background: #fff; border: 1.5px solid ${LINE};
               border-radius: 14px; padding: 11px 14px; transition: border-color .2s, box-shadow .2s; }
  .mk-search:focus-within { border-color: ${TEAL}; box-shadow: 0 0 0 3px rgba(79,163,138,0.12); }
  .mk-search input { flex: 1; border: none; outline: none; background: transparent; font: inherit;
                     font-size: 15px; color: ${INK}; }
  .mk-search input::placeholder { color: ${MUTED}; }
  .mk-search input:disabled { opacity: 0.6; }
  .mk-mic { flex-shrink: 0; border: none; background: transparent; font-size: 18px; line-height: 1;
            padding: 4px; cursor: pointer; border-radius: 999px; }
  .mk-mic.on { animation: mkPulse 1.1s ease infinite; }
  @keyframes mkPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
  .mk-voice-err { font-size: 11.5px; color: #B85450; margin-top: 6px; padding-left: 2px; }
  .mk-pills { display: flex; gap: 8px; overflow-x: auto; padding: 10px 16px; scrollbar-width: none; }
  .mk-pills::-webkit-scrollbar { display: none; }
  .mk-pill { flex-shrink: 0; border: 1px solid ${LINE}; background: #fff; color: ${INK};
             font: inherit; font-size: 12.5px; font-weight: 500; padding: 7px 13px; border-radius: 999px;
             cursor: pointer; transition: all .15s; white-space: nowrap; }
  .mk-pill.on { background: ${INK}; color: ${PAPER}; border-color: ${INK}; }
  .mk-filter { display: flex; gap: 8px; align-items: center; overflow-x: auto; padding: 0 16px 6px;
               scrollbar-width: none; }
  .mk-filter::-webkit-scrollbar { display: none; }
  .mk-sort { flex-shrink: 0; border: 1px solid ${LINE}; background: #fff; color: ${MUTED};
             font: inherit; font-size: 11.5px; font-weight: 600; padding: 6px 11px; border-radius: 999px;
             cursor: pointer; white-space: nowrap; }
  .mk-sort.on { border-color: ${TEAL}; color: ${INK}; background: rgba(79,163,138,0.08); }
  .mk-body { padding: 4px 16px 90px; max-width: 640px; margin: 0 auto; }
  .mk-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
              color: ${MUTED}; margin: 18px 0 10px; }
  .mk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .mk-card { position: relative; background: #fff; border: 1px solid ${LINE}; border-radius: 16px; overflow: hidden;
             cursor: pointer; animation: mkUp .4s ease both;
             box-shadow: 0 1px 0 rgba(14,40,35,.04), 0 8px 24px -14px rgba(14,40,35,.10); }
  .mk-card:active { transform: scale(0.98); }
  ${Array.from({ length: 12 }, (_, i) => `.mk-card:nth-child(${i + 1}) { animation-delay: ${i * 45}ms; }`).join('\n')}
  @keyframes mkUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .mk-img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: ${CREAM}; }
  .mk-img-fallback { width: 100%; aspect-ratio: 1; display: grid; place-items: center; background: ${CREAM};
                     font-family: ${SERIF}; font-size: 40px; color: ${GOLD}; }
  .mk-card-body { padding: 10px 12px 12px; }
  .mk-pname { font-size: 13.5px; font-weight: 600; line-height: 1.25; display: -webkit-box;
              -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .mk-pname-am { font-size: 11.5px; color: ${MUTED}; margin-top: 1px; }
  .mk-price { font-family: ${SERIF}; font-size: 16px; font-weight: 600; margin-top: 5px; }
  .mk-biz { font-size: 11px; color: ${MUTED}; margin-top: 3px; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap; }
  .mk-rating { font-size: 10.5px; color: ${GOLD}; font-weight: 600; margin-top: 3px; }
  .mk-reason { font-size: 10.5px; color: ${TEAL}; font-style: italic; margin-top: 4px; }
  .mk-heart { position: absolute; top: 8px; right: 8px; z-index: 2; border: none; cursor: pointer;
              width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
              background: rgba(251,248,241,0.9); font-size: 15px; line-height: 1;
              box-shadow: 0 2px 8px rgba(14,40,35,0.15); transition: transform .12s; }
  .mk-heart:active { transform: scale(1.2); }
  .mk-row { display: flex; gap: 12px; overflow-x: auto; scrollbar-width: none; padding-bottom: 4px; }
  .mk-row::-webkit-scrollbar { display: none; }
  .mk-row .mk-card { flex: 0 0 150px; }
  .mk-shop { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid ${LINE};
             border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; }
  .mk-shop-logo { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: ${CREAM};
                  display: grid; place-items: center; font-family: ${SERIF}; color: ${GOLD}; font-size: 20px; flex-shrink: 0; }
  .mk-chat-btn { border: none; background: ${TEAL}; color: #fff; font: inherit; font-size: 12.5px;
                 font-weight: 600; padding: 9px 14px; border-radius: 10px; cursor: pointer; white-space: nowrap; }
  .mk-more { display: block; width: 100%; margin: 18px 0 0; border: 1px solid ${LINE}; background: #fff;
             color: ${INK}; font: inherit; font-size: 14px; font-weight: 500; padding: 13px; border-radius: 12px; cursor: pointer; }
  .mk-empty { text-align: center; padding: 44px 20px; color: ${MUTED}; }
  .mk-empty .big { font-size: 36px; margin-bottom: 10px; }
  .mk-skel { border-radius: 16px; background: linear-gradient(100deg, ${CREAM} 40%, #fff 50%, ${CREAM} 60%);
             background-size: 200% 100%; animation: mkShimmer 1.2s infinite; aspect-ratio: 0.8; }
  @keyframes mkShimmer { to { background-position: -200% 0; } }
  .mk-overlay { position: fixed; inset: 0; background: rgba(14,40,35,0.45); z-index: 40;
                animation: mkFade .2s ease; }
  @keyframes mkFade { from { opacity: 0; } }
  .mk-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; background: ${PAPER};
              border-radius: 22px 22px 0 0; max-height: 86vh; overflow-y: auto;
              padding-bottom: calc(20px + env(safe-area-inset-bottom));
              animation: mkSlide .32s cubic-bezier(.2,.9,.3,1.05); }
  @keyframes mkSlide { from { transform: translateY(100%); } }
  .mk-sheet-grip { width: 40px; height: 4px; border-radius: 999px; background: ${LINE}; margin: 10px auto; }
  .mk-sheet-img { width: 100%; max-height: 300px; object-fit: cover; display: block; }
  .mk-sheet-body { padding: 16px 20px 8px; }
  .mk-sheet-name { font-family: ${SERIF}; font-size: 24px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.2; }
  .mk-sheet-price { font-family: ${SERIF}; font-size: 21px; color: ${GOLD}; margin-top: 6px; }
  .mk-sheet-desc { font-size: 14px; line-height: 1.55; color: #3a514c; margin-top: 12px; }
  .mk-sheet-biz { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding-top: 14px;
                  border-top: 1px solid ${LINE}; font-size: 13px; color: ${MUTED}; flex-wrap: wrap; }
  .mk-sheet-biz .open-shop { border: none; background: transparent; font: inherit; font-size: 13px;
                             font-weight: 700; color: ${INK}; cursor: pointer; padding: 0;
                             text-decoration: underline; text-decoration-color: ${LINE}; text-underline-offset: 3px; }
  .mk-order { display: block; width: calc(100% - 40px); margin: 16px auto 0; border: none;
              background: #229ED9; color: #fff; font: inherit; font-size: 16px; font-weight: 600;
              padding: 15px; border-radius: 14px; cursor: pointer;
              box-shadow: 0 6px 20px -6px rgba(34,158,217,0.5); }
  .mk-order:active { transform: scale(0.985); }
  .mk-sheet-actions { display: flex; gap: 10px; width: calc(100% - 40px); margin: 10px auto 0; }
  .mk-action { flex: 1; border: 1px solid ${LINE}; background: #fff; color: ${INK}; font: inherit;
               font-size: 13px; font-weight: 600; padding: 11px; border-radius: 12px; cursor: pointer; }
  .mk-action.on { border-color: ${TEAL}; color: ${TEAL}; background: rgba(79,163,138,0.08); }
  .mk-verified { color: ${TEAL}; }
  .mk-assist { display: flex; align-items: flex-start; gap: 8px; background: #fff;
               border: 1px solid ${LINE}; border-radius: 4px 16px 16px 16px; padding: 11px 14px;
               margin: 14px 0 4px; font-size: 13.5px; line-height: 1.45; color: #3a514c;
               box-shadow: 0 1px 0 rgba(14,40,35,.04), 0 6px 18px -12px rgba(14,40,35,.12); }
  .mk-chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0 2px; }
  .mk-chip { border: 1px solid ${TEAL}; background: rgba(79,163,138,0.08); color: ${INK};
             font: inherit; font-size: 12px; font-weight: 600; padding: 6px 12px;
             border-radius: 999px; cursor: pointer; }
  .mk-ask { border: 1px solid ${LINE}; background: #fff; color: ${INK}; font: inherit;
            font-size: 12px; font-weight: 600; padding: 7px 12px; border-radius: 999px;
            cursor: pointer; white-space: nowrap; }

  /* Bottom tab bar — Market / Saved */
  .mk-tabs { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex;
             background: rgba(251,248,241,0.96); backdrop-filter: blur(10px);
             border-top: 1px solid ${LINE};
             padding: 6px 10px calc(6px + env(safe-area-inset-bottom)); }
  .mk-tab { flex: 1; border: none; background: transparent; font: inherit; font-size: 11px;
            font-weight: 600; color: ${MUTED}; cursor: pointer; padding: 6px 0 4px;
            display: flex; flex-direction: column; align-items: center; gap: 2px; border-radius: 12px; }
  .mk-tab .ic { font-size: 20px; line-height: 1; }
  .mk-tab.on { color: ${INK}; }
  .mk-tab .badge { position: absolute; transform: translate(14px, -2px); background: ${TEAL}; color: #fff;
                   font-size: 9px; font-weight: 700; min-width: 15px; height: 15px; border-radius: 8px;
                   display: grid; place-items: center; padding: 0 4px; }

  /* Shop view — full overlay inside the Market */
  .mk-shopview { position: fixed; inset: 0; z-index: 45; background: ${PAPER}; overflow-y: auto;
                 animation: mkSlide .3s cubic-bezier(.2,.9,.3,1.02);
                 padding-bottom: calc(30px + env(safe-area-inset-bottom)); }
  .mk-shopview-head { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 10px;
                      background: rgba(251,248,241,0.94); backdrop-filter: blur(10px);
                      border-bottom: 1px solid ${LINE}; padding: 12px 16px; }
  .mk-back { border: none; background: #fff; border: 1px solid ${LINE}; width: 34px; height: 34px;
             border-radius: 50%; font-size: 16px; cursor: pointer; display: grid; place-items: center; flex-shrink: 0; }
  .mk-shopview-body { padding: 16px; max-width: 640px; margin: 0 auto; }
  .mk-shop-hero { display: flex; align-items: center; gap: 14px; }
  .mk-shop-hero .mk-shop-logo { width: 62px; height: 62px; font-size: 26px; }
  .mk-shop-name { font-family: ${SERIF}; font-size: 22px; font-weight: 500; letter-spacing: -0.01em; }
  .mk-follow { border: 1.5px solid ${INK}; background: ${INK}; color: ${PAPER}; font: inherit;
               font-size: 13px; font-weight: 600; padding: 9px 18px; border-radius: 999px; cursor: pointer; }
  .mk-follow.on { background: transparent; color: ${INK}; }

  /* Reviews */
  .mk-stars { display: inline-flex; gap: 2px; font-size: 20px; cursor: pointer; user-select: none; }
  .mk-stars.readonly { cursor: default; font-size: 13px; }
  .mk-review { padding: 10px 0; border-bottom: 1px solid ${LINE}; }
  .mk-review:last-child { border-bottom: none; }
  .mk-review-meta { display: flex; justify-content: space-between; align-items: center; }
  .mk-review-text { font-size: 13px; color: #3a514c; line-height: 1.5; margin-top: 4px; }
  .mk-review-form textarea { width: 100%; border: 1.5px solid ${LINE}; border-radius: 12px; padding: 10px 12px;
                             font: inherit; font-size: 14px; background: #fff; color: ${INK}; resize: vertical;
                             min-height: 64px; outline: none; margin-top: 10px; }
  .mk-review-form textarea:focus { border-color: ${TEAL}; }
  .mk-review-submit { margin-top: 10px; border: none; background: ${TEAL}; color: #fff; font: inherit;
                      font-size: 13.5px; font-weight: 600; padding: 10px 18px; border-radius: 11px; cursor: pointer; }
  .mk-review-note { font-size: 12px; color: ${MUTED}; margin-top: 8px; line-height: 1.45; }
`;
