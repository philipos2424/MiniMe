import { clsx } from 'clsx';

export function cn(...inputs) {
  return clsx(inputs);
}

export function formatPrice(amount) {
  return `${Number(amount).toLocaleString('en-ET')} ETB`;
}

export function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function confidenceColor(confidence) {
  if (confidence >= 0.85) return 'text-emerald-400';
  if (confidence >= 0.65) return 'text-yellow-400';
  return 'text-red-400';
}
