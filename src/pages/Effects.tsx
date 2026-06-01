import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import type { Translations } from '@/i18n/en';
import { SplitSquareHorizontal, FileCode2, Users, Sparkles, Type } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolCard {
  titleKey: keyof Translations['effectsPage'];
  descKey: keyof Translations['effectsPage'];
  path: string;
  Icon: React.ElementType;
  colorClass: string;
}

const tools: ToolCard[] = [
  {
    titleKey: 'bilingualSeparatorTitle',
    descKey: 'bilingualSeparatorDesc',
    path: '/effects/bilingual-separator',
    Icon: SplitSquareHorizontal,
    colorClass: 'bg-purple-500/10 text-purple-400',
  },
  {
    titleKey: 'assFormatterTitle',
    descKey: 'assFormatterDesc',
    path: '/effects/ass-formatter',
    Icon: FileCode2,
    colorClass: 'bg-sky-500/10 text-sky-400',
  },
  {
    titleKey: 'creditsFormatterTitle',
    descKey: 'creditsFormatterDesc',
    path: '/effects/credits-formatter',
    Icon: Users,
    colorClass: 'bg-emerald-500/10 text-emerald-400',
  },
  {
    titleKey: 'logoGeneratorTitle',
    descKey: 'logoGeneratorDesc',
    path: '/effects/logo-generator',
    Icon: Sparkles,
    colorClass: 'bg-amber-500/10 text-amber-400',
  },
  {
    titleKey: 'commonFontsTitle',
    descKey: 'commonFontsDesc',
    path: '/effects/common-fonts',
    Icon: Type,
    colorClass: 'bg-rose-500/10 text-rose-400',
  },
];

export default function EffectsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ep = t.effectsPage;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <div>
        <h1 className="text-lg font-semibold">{ep.title}</h1>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map(({ titleKey, descKey, path, Icon, colorClass }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={cn(
              'group flex flex-col gap-4 rounded-xl border border-border bg-card p-5 text-left',
              'transition-all duration-150 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5',
            )}
          >
            <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl', colorClass)}>
              <Icon className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                {ep[titleKey]}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">{ep[descKey]}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
