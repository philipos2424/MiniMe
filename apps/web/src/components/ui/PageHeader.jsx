'use client';
import { useLanguage } from '../../context/LanguageContext';

export default function PageHeader({ title, subtitleAm, subtitleEn, right }) {
  const { showAmharic } = useLanguage();
  const amVisible = showAmharic && subtitleAm;

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl md:text-3xl text-gold-light tracking-tight">{title}</h1>
        {(amVisible || subtitleEn) && (
          <p className="text-muted text-sm mt-1">
            {amVisible && <span>{subtitleAm}</span>}
            {amVisible && subtitleEn && <span> · </span>}
            {subtitleEn && <span>{subtitleEn}</span>}
          </p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
