import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import type { Translations } from '@/i18n/en';
import { Code2 } from 'lucide-react';
import { cn } from '@/components/ui/utils';

interface ToolCard {
  titleKey: keyof Translations['encodingPage'];
  descKey: keyof Translations['encodingPage'];
  path: string;
  Icon: React.ElementType;
  colorClass: string;
}

const tools: ToolCard[] = [
  {
    titleKey: 'ffmpegCodeGenTitle',
    descKey: 'ffmpegCodeGenDesc',
    path: '/encoding/ffmpeg-code-gen',
    Icon: Code2,
    colorClass: 'bg-red-500/10 text-red-400',
  },
];

export default function EncodingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ep = t.encodingPage;

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
