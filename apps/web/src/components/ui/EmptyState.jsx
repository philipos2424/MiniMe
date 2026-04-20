'use client';

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {Icon && (
        <div className="w-14 h-14 rounded-full bg-card border border-border flex items-center justify-center mb-4">
          <Icon size={24} className="text-muted" />
        </div>
      )}
      {title && (
        <h3 className="font-display text-lg text-gold-light mb-1">{title}</h3>
      )}
      {description && (
        <p className="text-muted text-sm max-w-sm">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
