import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowLeft, Type, CheckCircle2, XCircle, Loader2, Download, FolderOpen, RefreshCw } from 'lucide-react';

// ─── Runtime environment check ─────────────────────────────────────────────────

const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── Font definitions ──────────────────────────────────────────────────────────

interface FontDef {
  id: string;
  name: string;
  nameZh: string;
  license: 'commercial' | 'open';
  /**
   * If set, the action button opens this URL instead of downloading from repo.
   */
  externalUrl?: string;
  noteKey?: 'fzZhunYuanNote';
}

const FONTS: FontDef[] = [
  {
    id: 'fz-zhun-yuan',
    name: 'FZZhunYuan-M02',
    nameZh: '方正准圆 M02',
    license: 'commercial',
    externalUrl: 'https://www.foundertype.com/index.php/FontInfo/index/id/179',
    noteKey: 'fzZhunYuanNote',
  },
  {
    id: 'noto-sans-sc',
    name: 'Noto Sans SC Medium',
    nameZh: 'Noto 思源黑体',
    license: 'open',
  },
  {
    id: 'microsoft-yahei',
    name: 'Microsoft YaHei',
    nameZh: '微软雅黑',
    license: 'commercial',
    externalUrl: 'https://github.com/dolbydu/font/blob/master/unicode/Microsoft%20Yahei.ttf',
  },
];

// ─── Tauri helpers ─────────────────────────────────────────────────────────────

type FontStatus = 'checking' | 'installed' | 'not-installed';

async function tauriCheckFont(fontId: string): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<string>('check_font_installed', { fontId });
  return result === 'installed';
}

async function tauriDownloadFont(fontId: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('download_and_install_font', { fontId });
}

async function tauriOpenFontsDir(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_fonts_directory');
}

async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function CommonFontsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const cf = t.commonFonts;

  const [statuses, setStatuses] = useState<Record<string, FontStatus>>(() =>
    Object.fromEntries(FONTS.map((f) => [f.id, 'checking'])),
  );
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successIds, setSuccessIds] = useState<Set<string>>(new Set());

  // ── Check all font statuses ────────────────────────────────────────────────
  const checkAllFonts = useCallback(async () => {
    if (!isTauri()) {
      // Browser dev mode: mark all as not-installed
      setStatuses(Object.fromEntries(FONTS.map((f) => [f.id, 'not-installed'])));
      return;
    }
    setStatuses(Object.fromEntries(FONTS.map((f) => [f.id, 'checking'])));
    await Promise.all(
      FONTS.map(async (font) => {
        try {
          const installed = await tauriCheckFont(font.id);
          setStatuses((prev) => ({ ...prev, [font.id]: installed ? 'installed' : 'not-installed' }));
        } catch {
          setStatuses((prev) => ({ ...prev, [font.id]: 'not-installed' }));
        }
      }),
    );
  }, []);

  useEffect(() => {
    checkAllFonts();
  }, [checkAllFonts]);

  // ── Listen for progress events ──────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<[string, number]>('font-install-progress', (event) => {
        const [fontId, progress] = event.payload;
        setDownloadProgress((prev) => ({ ...prev, [fontId]: progress }));
      });
    })();
    return () => unlisten?.();
  }, []);

  // ── Download & install ──────────────────────────────────────────────────────
  const handleDownload = useCallback(
    async (fontId: string) => {
      if (!isTauri() || downloading) return;
      setDownloading(fontId);
      setErrors((prev) => ({ ...prev, [fontId]: '' }));
      setDownloadProgress((prev) => ({ ...prev, [fontId]: 0 }));
      try {
        await tauriDownloadFont(fontId);
        setStatuses((prev) => ({ ...prev, [fontId]: 'installed' }));
        setSuccessIds((prev) => new Set(prev).add(fontId));
        setTimeout(
          () => setSuccessIds((prev) => { const next = new Set(prev); next.delete(fontId); return next; }),
          4000,
        );
      } catch (err) {
        setErrors((prev) => ({ ...prev, [fontId]: String(err) }));
      } finally {
        setDownloading(null);
      }
    },
    [downloading],
  );

  // ── Open fonts directory ────────────────────────────────────────────────────
  const handleOpenDir = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await tauriOpenFontsDir();
    } catch (err) {
      console.error('Failed to open fonts directory:', err);
    }
  }, []);

  // ─── Render helpers ─────────────────────────────────────────────────────────

  function StatusBadge({ fontId }: { fontId: string }) {
    const status = statuses[fontId];
    if (status === 'checking') {
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {cf.statusChecking}
        </span>
      );
    }
    if (status === 'installed') {
      return (
        <span className="flex items-center gap-1 text-xs text-emerald-500">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {cf.statusInstalled}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <XCircle className="h-3.5 w-3.5" />
        {cf.statusNotInstalled}
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-6 py-4 backdrop-blur-sm">
        <button
          onClick={() => navigate('/effects')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10">
          <Type className="h-4 w-4 text-rose-400" />
        </div>
        <div>
          <h1 className="text-sm font-semibold">{cf.title}</h1>
          <p className="text-xs text-muted-foreground">{cf.description}</p>
        </div>

        {/* Actions */}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={checkAllFonts}
            disabled={Object.values(statuses).some((s) => s === 'checking')}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {cf.refreshStatus}
          </Button>
          {isTauri() && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={handleOpenDir}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {cf.openFontsDir}
            </Button>
          )}
        </div>
      </div>

      {/* ── Font cards ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 p-6">
        {FONTS.map((font) => {
          const status = statuses[font.id];
          const isDownloading = downloading === font.id;
          const progress = downloadProgress[font.id] ?? 0;
          const error = errors[font.id];
          const showSuccess = successIds.has(font.id);
          const isInstalled = status === 'installed';

          return (
            <div
              key={font.id}
              className={cn(
                'rounded-xl border border-border bg-card p-5',
                'transition-shadow duration-150',
                isInstalled && 'border-emerald-500/30',
              )}
            >
              <div className="flex items-start gap-4">
                {/* Left: font info */}
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{font.name}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{font.nameZh}</span>
                    {font.license === 'open' ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                        SIL OFL
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                        Commercial
                      </span>
                    )}
                  </div>

                  <StatusBadge fontId={font.id} />

                  {/* External URL note (for fonts without direct download) */}
                  {font.noteKey && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{cf[font.noteKey]}</p>
                  )}

                  {/* Progress bar */}
                  {isDownloading && (
                    <div className="mt-2 space-y-1">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {cf.downloading} {Math.round(progress * 100)}%
                      </p>
                    </div>
                  )}

                  {/* Error */}
                  {error && !isDownloading && (
                    <p className="text-xs text-destructive">{cf.installError}: {error}</p>
                  )}

                  {/* Success */}
                  {showSuccess && (
                    <p className="text-xs text-emerald-500">{cf.installSuccess}</p>
                  )}
                </div>

                {/* Right: action button */}
                {!isInstalled && (
                  font.externalUrl ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5 text-xs"
                      onClick={() => openExternalUrl(font.externalUrl!)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {cf.visitWebsite}
                    </Button>
                  ) : isTauri() ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5 text-xs"
                      disabled={!!downloading || status === 'checking'}
                      onClick={() => handleDownload(font.id)}
                    >
                      {isDownloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      {isDownloading ? cf.downloading : cf.download}
                    </Button>
                  ) : null
                )}
              </div>
            </div>
          );
        })}

        {/* ── Open directory hint ──────────────────────────────────────────── */}
        {isTauri() && (
          <p className="text-center text-xs text-muted-foreground">{cf.openFontsDirHint}</p>
        )}
      </div>
    </div>
  );
}
