import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';
import { ArrowLeft, Wand2, Copy, Check, Film } from 'lucide-react';

// ─── Runtime environment check ─────────────────────────────────────────────────

const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── Resolution presets ────────────────────────────────────────────────────────

type ResolutionPreset = '480p' | '720p' | '1080p' | 'custom';

const PRESET_RES: Record<Exclude<ResolutionPreset, 'custom'>, { w: number; h: number }> = {
  '480p': { w: 854, h: 480 },
  '720p': { w: 1280, h: 720 },
  '1080p': { w: 1920, h: 1080 },
};

// ─── Tauri helpers ─────────────────────────────────────────────────────────────

async function tauriGetVideoResolution(path: string): Promise<{ width: number; height: number }> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<{ width: number; height: number }>('get_video_resolution', { path });
}

async function pickVideoFile(): Promise<{ path: string; name: string } | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: false,
    filters: [
      { name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'ts', 'wmv', 'm4v', 'webm'] },
    ],
  });
  if (typeof result === 'string' && result) {
    const name = result.replace(/\\/g, '/').split('/').pop() ?? result;
    return { path: result, name };
  }
  return null;
}

// ─── Logo builder ──────────────────────────────────────────────────────────────

// Reference positions are defined at 1080p (1920×1080).
// All values are scaled proportionally to the target resolution.

function buildLogoOutput(
  startTime: string,
  endTime: string,
  width: number,
  height: number,
): string {
  const rx = width / 1920;
  const ry = height / 1080;

  const px = (x: number) => Math.round(x * rx);
  const py = (y: number) => Math.round(y * ry);
  const pf = (fs: number) => (Math.round(fs * ry * 10) / 10).toFixed(1);
  const psp = (sp: number) => (Math.round(sp * ry * 10) / 10).toFixed(1);

  const d = `Dialogue: 0,${startTime},${endTime},Logo,,0,0,0,,`;

  const lines = [
    `${d}{\\fad(0,0)\\1a&HFF\\an1\\pos(${px(1704)},${py(982)})}.`,
    `${d}{\\b0\\fad(0,0)\\c&H00FFFFFF&\\fs${pf(42.7)}\\fscx220\\pos(${px(1587)},${py(945)})}Q`,
    `${d}{\\b0\\fad(0,0)\\fs${pf(64.0)}\\c&H0000DD&\\pos(${px(1640)},${py(963)})}■`,
    `${d}{\\b0\\fad(0,0)\\fs${pf(64.0)}\\c&H0A7DFE&\\pos(${px(1685)},${py(963)})}■`,
    `${d}{\\b0\\fad(0,0)\\fs${pf(64.0)}\\c&H01E0CA&\\pos(${px(1730)},${py(963)})}■`,
    `${d}{\\b0\\fad(0,0)\\fs${pf(64.0)}\\c&HFFFF75&\\pos(${px(1775)},${py(963)})}■`,
    `${d}{\\b0\\fad(0,0)\\fs${pf(64.0)}\\c&HFD22C7&\\pos(${px(1820)},${py(963)})}■`,
    `${d}{\\b1\\fad(0,0)\\fs${pf(29.9)}\\c&H00FFFFFF&\\pos(${px(1640)},${py(941)})}A`,
    `${d}{\\b1\\fad(0,0)\\fs${pf(29.9)}\\c&H00FFFFFF&\\pos(${px(1681)},${py(941)})}F`,
    `${d}{\\b1\\fad(0,0)\\fs${pf(29.9)}\\c&H00FFFFFF&\\pos(${px(1730)},${py(941)})}O`,
    `${d}{\\b1\\fad(0,0)\\fs${pf(29.9)}\\c&H00FFFFFF&\\pos(${px(1775)},${py(941)})}N`,
    `${d}{\\b1\\fad(0,0)\\fs${pf(29.9)}\\c&H00FFFFFF&\\pos(${px(1820)},${py(941)})}E`,
    `${d}{\\a1\\b1\\fad(0,0)\\fs${pf(14.9)}\\c&H00FFFFFF&\\fsp${psp(2.1)}\\fscx220\\pos(${px(1615)},${py(973)})}同志亦凡人中文站`,
    `${d}{\\fad(0,0)\\1a&HFF\\an1\\pos(${px(1704)},${py(982)})}.`,
  ];

  return lines.join('\n');
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function LogoGeneratorPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const lg = t.logoGenerator;
  const ep = t.effectsPage;

  const [startTime, setStartTime] = useState('0:00:35.74');
  const [endTime, setEndTime] = useState('0:00:43.26');
  const [preset, setPreset] = useState<ResolutionPreset>('1080p');
  const [manualW, setManualW] = useState('1920');
  const [manualH, setManualH] = useState('1080');
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [vidDragging, setVidDragging] = useState(false);
  const [output, setOutput] = useState('');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const vidInputRef = useRef<HTMLInputElement>(null);
  const locationPathRef = useRef('/effects/logo-generator');

  const effectiveRes = useCallback((): { w: number; h: number } | null => {
    if (preset !== 'custom') return { w: PRESET_RES[preset].w, h: PRESET_RES[preset].h };
    const w = parseInt(manualW, 10);
    const h = parseInt(manualH, 10);
    if (!w || !h || w <= 0 || h <= 0) return null;
    return { w, h };
  }, [preset, manualW, manualH]);

  // ── Tauri drag-drop listener ───────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;

    (async () => {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      unlisten = await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
        if (locationPathRef.current !== '/effects/logo-generator') return;
        const { type } = event.payload;
        if (type === 'leave') { setVidDragging(false); return; }
        if (type !== 'drop' || !('paths' in event.payload)) return;
        setVidDragging(false);
        const paths: string[] = event.payload.paths;
        const vidExts = ['.mp4', '.mkv', '.mov', '.avi', '.ts', '.wmv', '.m4v', '.webm'];
        for (const p of paths) {
          if (vidExts.some((ext) => p.toLowerCase().endsWith(ext))) {
            setVideoPath(p);
            setVideoName(p.replace(/\\/g, '/').split('/').pop() ?? p);
            setDetectError(null);
            break;
          }
        }
      });
    })();

    return () => { unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Video handlers ─────────────────────────────────────────────────────────

  const handleVidBrowse = useCallback(async () => {
    if (isTauri()) {
      const picked = await pickVideoFile();
      if (picked) {
        setVideoPath(picked.path);
        setVideoName(picked.name);
        setDetectError(null);
      }
    } else {
      vidInputRef.current?.click();
    }
  }, []);

  const handleVidInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setVideoName(file.name); setVideoPath(null); }
    e.target.value = '';
  }, []);

  const handleVidDragOver = useCallback((e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    setVidDragging(true);
  }, []);

  const handleVidDragLeave = useCallback(() => {
    if (!isTauri()) setVidDragging(false);
  }, []);

  const handleVidDrop = useCallback((e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    setVidDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) { setVideoName(file.name); setVideoPath(null); }
  }, []);

  // ── Resolution detection ───────────────────────────────────────────────────

  const handleDetectResolution = useCallback(async () => {
    if (!videoPath) return;
    if (!isTauri()) { setDetectError(lg.ffmpegRequired); return; }
    setDetecting(true);
    setDetectError(null);
    try {
      const res = await tauriGetVideoResolution(videoPath);
      setManualW(String(res.width));
      setManualH(String(res.height));
      if (res.height === 1080) setPreset('1080p');
      else if (res.height === 720) setPreset('720p');
      else if (res.height === 480) setPreset('480p');
      else setPreset('custom');
    } catch (err) {
      setDetectError(String(err));
    } finally {
      setDetecting(false);
    }
  }, [videoPath, lg.ffmpegRequired]);

  const handlePresetChange = useCallback((p: ResolutionPreset) => {
    setPreset(p);
    if (p !== 'custom') {
      setManualW(String(PRESET_RES[p].w));
      setManualH(String(PRESET_RES[p].h));
    }
  }, []);

  // ── Generation ─────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(() => {
    setGenerateError(null);
    const res = effectiveRes();
    if (!res) { setGenerateError(lg.noResolution); return; }
    setOutput(buildLogoOutput(startTime.trim(), endTime.trim(), res.w, res.h));
  }, [startTime, endTime, effectiveRes, lg.noResolution]);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/effects')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-base font-semibold">{ep.logoGeneratorTitle}</h1>
          <p className="text-xs text-muted-foreground">{ep.logoGeneratorDesc}</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">

        {/* Time range */}
        <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">{lg.timeRange}</p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{lg.startTime}</label>
              <input
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="H:MM:SS.cc"
                className="w-36 rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <span className="pb-2 text-muted-foreground">→</span>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{lg.endTime}</label>
              <input
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="H:MM:SS.cc"
                className="w-36 rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
        </section>

        {/* Resolution */}
        <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">{lg.resolution}</p>

          {/* Video drop zone */}
          <div
            onDragOver={handleVidDragOver}
            onDragLeave={handleVidDragLeave}
            onDrop={handleVidDrop}
            onClick={handleVidBrowse}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-6 transition-colors',
              vidDragging
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50',
            )}
          >
            <Film className="h-6 w-6 text-muted-foreground" />
            {videoName ? (
              <p className="text-sm text-foreground">{videoName}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{lg.videoDropzone}</p>
                <p className="text-xs text-muted-foreground/60">{lg.videoDropzoneHint}</p>
              </>
            )}
          </div>
          <input
            ref={vidInputRef}
            type="file"
            accept=".mp4,.mkv,.mov,.avi,.ts,.wmv,.m4v,.webm"
            className="hidden"
            onChange={handleVidInputChange}
          />

          {videoPath && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDetectResolution}
              disabled={detecting}
              className="self-start"
            >
              {detecting ? lg.detecting : lg.detectResolution}
            </Button>
          )}
          {detectError && <p className="text-xs text-destructive">{detectError}</p>}

          {/* Preset buttons */}
          <div className="flex flex-wrap gap-2">
            {(['480p', '720p', '1080p', 'custom'] as ResolutionPreset[]).map((p) => (
              <button
                key={p}
                onClick={() => handlePresetChange(p)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  preset === p
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50',
                )}
              >
                {p === '480p'
                  ? lg.preset480p
                  : p === '720p'
                    ? lg.preset720p
                    : p === '1080p'
                      ? lg.preset1080p
                      : lg.presetCustom}
              </button>
            ))}
          </div>

          {/* Manual inputs */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{lg.width}</label>
              <input
                type="number"
                value={manualW}
                onChange={(e) => { setManualW(e.target.value); setPreset('custom'); }}
                className="w-24 rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <span className="pb-2 text-muted-foreground">×</span>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{lg.height}</label>
              <input
                type="number"
                value={manualH}
                onChange={(e) => { setManualH(e.target.value); setPreset('custom'); }}
                className="w-24 rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
        </section>

        {/* Generate */}
        <div className="flex flex-col gap-2">
          <Button onClick={handleGenerate} className="self-start">
            <Wand2 className="mr-2 h-4 w-4" />
            {lg.generate}
          </Button>
          {generateError && <p className="text-xs text-destructive">{generateError}</p>}
        </div>

        {/* Output */}
        {output && (
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{lg.output}</p>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? (
                  <Check className="mr-2 h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="mr-2 h-3.5 w-3.5" />
                )}
                {copied ? lg.copied : lg.copy}
              </Button>
            </div>
            <pre className="w-full select-all break-all whitespace-pre-wrap rounded-xl border border-border bg-card px-4 py-3 font-mono text-xs text-foreground">
              {output}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
