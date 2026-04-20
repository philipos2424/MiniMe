'use client';
export default function TopBar() {
  return (
    <header className="h-14 border-b border-border bg-card/50 flex items-center px-6 gap-4 shrink-0">
      <div className="flex-1" />
      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="MiniMe active" />
      <span className="text-muted text-xs">MiniMe active</span>
    </header>
  );
}
