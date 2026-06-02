import { Outlet, useLocation } from 'react-router-dom';
import { TopNav } from './TopNav';
import TranslationPage from '@/pages/Translation';
import ProofreadingPage from '@/pages/Proofreading';
import CompactVideoPage from '@/pages/tools/CompactVideo';

// Pages that should stay mounted to preserve state across navigation
const PERSISTENT_PAGES: Record<string, { wrapperClass: string }> = {
  '/translation': { wrapperClass: 'flex flex-col h-full overflow-hidden' },
  '/proofreading': { wrapperClass: 'h-full overflow-hidden' },
  '/tools/compact-video': { wrapperClass: 'h-full overflow-auto p-6' },
};

const FULL_BLEED_ROUTES = new Set<string>();

export function Layout() {
  const location = useLocation();
  const path = location.pathname;
  const isPersistentPath = path in PERSISTENT_PAGES;
  const routedWrapperClass = FULL_BLEED_ROUTES.has(path)
    ? 'h-full overflow-hidden'
    : 'h-full overflow-auto p-6';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden relative">
          {/* Always-mounted persistent pages — hidden via CSS when inactive */}
          <div className={PERSISTENT_PAGES['/translation'].wrapperClass} style={{ display: path === '/translation' ? undefined : 'none' }}>
            <TranslationPage />
          </div>
          <div className={PERSISTENT_PAGES['/proofreading'].wrapperClass} style={{ display: path === '/proofreading' ? undefined : 'none' }}>
            <ProofreadingPage />
          </div>
          <div className={PERSISTENT_PAGES['/tools/compact-video'].wrapperClass} style={{ display: path === '/tools/compact-video' ? undefined : 'none' }}>
            <CompactVideoPage />
          </div>
          {/* Standard routed pages */}
          {!isPersistentPath && (
            <div className={routedWrapperClass}>
              <Outlet />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
