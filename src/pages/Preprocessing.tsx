import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { Scissors, Film, ScanText, Music2 } from 'lucide-react';
import { cn } from '@/components/ui/utils';

interface ToolCard {
  navKey: 'subtitleExtraction' | 'compactVideo' | 'hardSubtitleExtraction' | 'audioExtraction';
  descKey: 'subtitleExtractionDesc' | 'compactVideoDesc' | 'hardSubtitleExtractionDesc' | 'audioExtractionDesc';
  path: string;
  Icon: React.ElementType;
  colorClass: string;
}

const tools: ToolCard[] = [
  {
    navKey: 'subtitleExtraction',
    descKey: 'subtitleExtractionDesc',
    path: '/tools/subtitle-extraction',
    Icon: Scissors,
    colorClass: 'bg-sky-500/10 text-sky-400',
  },
  {
    navKey: 'audioExtraction',
    descKey: 'audioExtractionDesc',
    path: '/tools/audio-extraction',
    Icon: Music2,
    colorClass: 'bg-green-500/10 text-green-400',
  },
  {
    navKey: 'compactVideo',
    descKey: 'compactVideoDesc',
    path: '/tools/compact-video',
    Icon: Film,
    colorClass: 'bg-orange-500/10 text-orange-400',
  },
  {
    navKey: 'hardSubtitleExtraction',
    descKey: 'hardSubtitleExtractionDesc',
    path: '/tools/hard-subtitle-extraction',
    Icon: ScanText,
    colorClass: 'bg-rose-500/10 text-rose-400',
  },
];

export default function PreprocessingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pp = t.preprocessingPage;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <div>
        <h1 className="text-lg font-semibold">{pp.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{pp.description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map(({ navKey, descKey, path, Icon, colorClass }) => (
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
                {t.nav[navKey]}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {pp[descKey]}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
