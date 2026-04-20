'use client';

const VARIANTS = {
  primary: 'bg-gold text-bg hover:bg-gold-light disabled:opacity-50',
  secondary: 'bg-card border border-border text-body hover:border-gold/40 disabled:opacity-50',
  ghost: 'bg-transparent text-muted hover:text-body hover:bg-card disabled:opacity-50',
  danger: 'bg-red-500 text-white hover:bg-red-600 disabled:opacity-50',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-xs min-h-[36px]',
  md: 'px-4 py-2.5 text-sm min-h-[44px]',
  lg: 'px-5 py-3 text-base min-h-[48px]',
};

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  as: Tag = 'button',
  ...rest
}) {
  return (
    <Tag
      type={Tag === 'button' ? type : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
