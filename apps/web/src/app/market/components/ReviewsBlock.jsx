'use client';
/**
 * ReviewsBlock — star summary + review list + write-a-review form.
 * Reads are public; writes require Telegram initData and a prior chat with
 * the shop (the API answers 403 'chat_first' otherwise — we then nudge the
 * user to chat first, which is exactly the behavior we want to reward).
 */
import { useEffect, useState } from 'react';
import { GOLD, MUTED, INK, tgInitData } from '../lib';

function Stars({ value, onChange }) {
  return (
    <span className={`mk-stars${onChange ? '' : ' readonly'}`} role={onChange ? 'radiogroup' : undefined}>
      {[1, 2, 3, 4, 5].map(n => (
        <span
          key={n}
          onClick={onChange ? () => onChange(n) : undefined}
          style={{ opacity: n <= value ? 1 : 0.25 }}
          aria-hidden
        >⭐</span>
      ))}
    </span>
  );
}

function timeAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function ReviewsBlock({ businessId, chatUrl, onChat, canEngage, embeddedReviews = null, embeddedSummary = null }) {
  const [summary, setSummary] = useState(embeddedSummary); // { average_rating, total_reviews }
  const [reviews, setReviews] = useState(embeddedReviews);
  const [writing, setWriting] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [state, setState] = useState('idle'); // idle | saving | done | chat_first | error

  useEffect(() => {
    if (embeddedReviews) return; // shop endpoint already delivered them
    let alive = true;
    fetch(`/api/market/reviews?business_id=${businessId}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        setSummary({ average_rating: j.average_rating, total_reviews: j.total_reviews });
        setReviews(j.reviews || []);
      })
      .catch(() => alive && setReviews([]));
    return () => { alive = false; };
  }, [businessId]); // eslint-disable-line

  async function submit() {
    if (!rating || state === 'saving') return;
    setState('saving');
    try {
      const r = await fetch('/api/market/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': tgInitData() },
        body: JSON.stringify({ business_id: businessId, rating, comment }),
      });
      const j = await r.json();
      if (r.status === 403 && j.error === 'chat_first') { setState('chat_first'); return; }
      if (!r.ok) throw new Error(j.error || 'failed');
      setState('done');
      setWriting(false);
      setSummary({ average_rating: j.average_rating, total_reviews: j.total_reviews });
      setReviews(prev => [{ rating, comment, created_at: new Date().toISOString() }, ...(prev || [])]);
    } catch {
      setState('error');
    }
  }

  const total = summary?.total_reviews || 0;

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #E4DED1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>
          Reviews
        </div>
        {total > 0 && (
          <div style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>
            ⭐ {summary.average_rating}/5 ({total})
          </div>
        )}
      </div>

      {reviews === null ? (
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8 }}>Loading reviews…</div>
      ) : reviews.length === 0 ? (
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8 }}>No reviews yet — be the first!</div>
      ) : (
        reviews.slice(0, 5).map((rv, i) => (
          <div key={i} className="mk-review">
            <div className="mk-review-meta">
              <Stars value={rv.rating} />
              <span style={{ fontSize: 11, color: MUTED }}>{timeAgo(rv.created_at)}</span>
            </div>
            {rv.comment && <div className="mk-review-text">&ldquo;{rv.comment}&rdquo;</div>}
          </div>
        ))
      )}

      {canEngage && state !== 'done' && (
        !writing ? (
          <button className="mk-action" style={{ marginTop: 10, width: '100%' }} onClick={() => setWriting(true)}>
            ✍️ Write a review
          </button>
        ) : (
          <div className="mk-review-form" style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>Your rating:</span>
              <Stars value={rating} onChange={setRating} />
            </div>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value.slice(0, 500))}
              placeholder="How was your experience with this shop?"
            />
            <button className="mk-review-submit" onClick={submit} disabled={!rating || state === 'saving'}
              style={{ opacity: !rating || state === 'saving' ? 0.6 : 1 }}>
              {state === 'saving' ? 'Sending…' : 'Submit review'}
            </button>
            {state === 'chat_first' && (
              <div className="mk-review-note">
                💬 Chat with the shop first, then come back to review.{' '}
                {(chatUrl || onChat) && (
                  <button className="mk-review-submit" style={{ marginTop: 8, display: 'block' }}
                    onClick={() => onChat ? onChat() : null}>
                    💬 Chat with the shop
                  </button>
                )}
              </div>
            )}
            {state === 'error' && (
              <div className="mk-review-note" style={{ color: '#B85450' }}>
                Couldn't save your review — please try again.
              </div>
            )}
          </div>
        )
      )}
      {state === 'done' && (
        <div className="mk-review-note" style={{ color: '#4FA38A', fontWeight: 600 }}>
          ✅ Thanks — your review is live!
        </div>
      )}
    </div>
  );
}
