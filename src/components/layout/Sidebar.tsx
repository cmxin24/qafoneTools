import { NavLink } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { cn } from '@/components/ui/utils';
import { Scissors, Film, ScanText } from 'lucide-react';

interface ToolItem {
  key: 'subtitleExtraction' | 'compactVideo' | 'hardSubtitleExtraction';
  path: string;
  Icon: React.ElementType;
}

const tools: ToolItem[] = [
  { key: 'subtitleExtraction',     path: '/tools/subtitle-extraction',      Icon: Scissors  },
  { key: 'compactVideo',           path: '/tools/compact-video',            Icon: Film      },
  { key: 'hardSubtitleExtraction', path: '/tools/hard-subtitle-extraction', Icon: ScanText  },
];

export function Sidebar() {
  const { t } = useI18n();

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-card/50">
      {/* Section header */}
      <div className="px-4 pt-5 pb-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground select-none">
          {t.nav.commonTools}
        </p>
      </div>

      <nav className="flex flex-col gap-0.5 px-2">
        {tools.map(({ key, path, Icon }) => (
          <NavLink
            key={key}
            to={path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : '')} />
                {t.nav[key]}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom padding */}
      <div className="flex-1" />
    </aside>
  );
}
