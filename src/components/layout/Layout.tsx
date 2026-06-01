import { Outlet, useLocation } from 'react-router-dom';
import { TopNav } from './TopNav';
import TranslationPage from '@/pages/Translation';
import CompactVideoPage from '@/pages/tools/CompactVideo';

// Pages that should stay mounted to preserve state across navigation
const PERSISTENT_PAGES: Record<string, { wrapperClass: string }> = {
  '/translation': { wrapperClass: 'flex flex-col h-full overflow-hidden' },
  '/tools/compact-video': { wrapperClass: 'h-full overflow-auto p-6' },
};

export function Layout() {
  const location = useLocation();
  const path = location.pathname;
  const isPersistentPath = path in PERSISTENT_PAGES;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden relative">
          {/* Always-mounted persistent pages — hidden via CSS when inactive */}
          <div className={PERSISTENT_PAGES['/translation'].wrapperClass} style={{ display: path === '/translation' ? undefined : 'none' }}>
            <TranslationPage />
          </div>
          <div className={PERSISTENT_PAGES['/tools/compact-video'].wrapperClass} style={{ display: path === '/tools/compact-video' ? undefined : 'none' }}>
            <CompactVideoPage />
          </div>
          {/* Standard routed pages */}
          {!isPersistentPath && (
            <div className="h-full overflow-auto p-6">
              <Outlet />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
