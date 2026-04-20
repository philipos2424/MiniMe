'use client';

export default function Card({ children, className = '', hover = false, as: Tag = 'div', ...rest }) {
  const hoverCls = hover ? 'hover:border-gold/40 transition' : '';
  return (
    <Tag
      className={`bg-card border border-border rounded-xl p-4 ${hoverCls} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
