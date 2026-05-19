import { NavLink, useLocation } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { SettingsDialog } from '@/components/SettingsDialog';
import { cn } from '@/lib/utils';
import {
  Languages,
  Clock,
  CheckSquare,
  Clock3,
  Sparkles,
  Film,
  ChevronRight,
} from 'lucide-react';

const workflowSteps = [
  { key: 'translation', path: '/translation', Icon: Languages },
  { key: 'timeline', path: '/timeline', Icon: Clock },
  { key: 'proofreading', path: '/proofreading', Icon: CheckSquare },
  { key: 'secondaryTimeline', path: '/secondary-timeline', Icon: Clock3 },
  { key: 'effects', path: '/effects', Icon: Sparkles },
  { key: 'encoding', path: '/encoding', Icon: Film },
] as const;

export function TopNav() {
  const { t } = useI18n();
  const location = useLocation();

  const currentStepIndex = workflowSteps.findIndex((s) => location.pathname.startsWith(s.path));

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/80 backdrop-blur-sm px-4 z-30">
      {/* App Logo / Name */}
      <div className="flex items-center gap-2 min-w-[160px]">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm select-none">
          QF
        </div>
        <span className="font-semibold text-foreground truncate">{t.nav.appName}</span>
      </div>

      {/* Workflow Steps */}
      <nav className="flex items-center gap-0.5" aria-label="Workflow steps">
        {workflowSteps.map(({ key, path, Icon }, index) => {
          const isActive = location.pathname.startsWith(path);
          const isPast = currentStepIndex > index;
          return (
            <div key={key} className="flex items-center">
              <NavLink
                to={path}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : isPast
                    ? 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                )}
              >
                <Icon
                  className={cn(
                    'h-3.5 w-3.5',
                    isActive ? 'text-primary-foreground' : isPast ? 'opacity-60' : 'opacity-60'
                  )}
                />
                <span className="hidden lg:inline">
                  {t.nav[key as keyof typeof t.nav]}
                </span>
              </NavLink>
              {index < workflowSteps.length - 1 && (
                <ChevronRight className="h-3 w-3 text-muted-foreground/40 mx-0.5 shrink-0" />
              )}
            </div>
          );
        })}
      </nav>

      {/* Settings */}
      <div className="flex items-center gap-2 min-w-[160px] justify-end">
        <SettingsDialog />
      </div>
    </header>
  );
}
