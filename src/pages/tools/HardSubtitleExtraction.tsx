import { ScanText } from 'lucide-react';
import { useI18n } from '@/i18n';

export default function HardSubtitleExtractionPage() {
  const { t } = useI18n();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-500/10">
        <ScanText className="h-10 w-10 text-amber-500" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">{t.nav.hardSubtitleExtraction}</h2>
        <p className="max-w-sm text-muted-foreground text-sm leading-relaxed">
          {t.pages.comingSoonDesc}
        </p>
      </div>
      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs font-medium text-amber-500">
        {t.pages.comingSoon}
      </span>
    </div>
  );
}
