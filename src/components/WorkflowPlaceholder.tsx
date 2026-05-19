import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface WorkflowPlaceholderProps {
  titleKey: keyof ReturnType<typeof useI18n>['t']['pages'];
  Icon: LucideIcon;
  step: number;
  color: string;
}

export function WorkflowPlaceholder({ titleKey, Icon, step, color }: WorkflowPlaceholderProps) {
  const { t } = useI18n();

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-6 text-center max-w-md">
        <div
          className={cn(
            'flex h-24 w-24 items-center justify-center rounded-2xl',
            color
          )}
        >
          <Icon className="h-12 w-12" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
              {step}
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t.pages[titleKey]}
            </h1>
          </div>
          <p className="text-muted-foreground">{t.pages.comingSoonDesc}</p>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-dashed border-muted px-4 py-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          {t.pages.comingSoon}
        </div>
      </div>
    </div>
  );
}
