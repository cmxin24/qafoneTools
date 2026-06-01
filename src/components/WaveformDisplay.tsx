import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type MouseEvent,
} from 'react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Download } from 'lucide-react';

export interface SrtEntry {
  index: number;
  startMs: number;
  endMs: number;
  originalText: string;
  translatedText: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  type: 'empty' | 'entry';
  timeMs?: number;
  entryIdx?: number;
}

type DragTarget =
  | { type: 'seek' }
  | { type: 'handle'; entryIdx: number; handle: 'start' | 'end'; initMs: number; initX: number }
  | { type: 'move'; entryIdx: number; initStartMs: number; initEndMs: number; initX: number };

interface Props {
  peaks: Float32Array | null;
  duration: number;
  currentTime: number;
  srtEntries: SrtEntry[];
  ffmpegStatus: 'checking' | 'available' | 'not-found' | 'downloading' | 'done';
  waveformStatus: 'idle' | 'loading' | 'ready' | 'error';
  waveformError?: string;
  onSeek: (time: number) => void;
  onEntryUpdate: (idx: number, changes: Partial<Pick<SrtEntry, 'startMs' | 'endMs'>>) => void;
  onInsertEntry: (startMs: number) => void;
  onDeleteEntry: (idx: number) => void;
  onMergeWithPrev: (idx: number) => void;
  onMergeWithNext: (idx: number) => void;
  onDownloadFfmpeg: () => void;
}

// Zoom levels in seconds — default 20s, +/- 5s per step
const ZOOM_MIN = 5;
const ZOOM_MAX = 120;

export function WaveformDisplay({
  peaks,
  duration,
  currentTime,
  srtEntries,
  ffmpegStatus,
  waveformStatus,
  waveformError,
  onSeek,
  onEntryUpdate,
  onInsertEntry,
  onDeleteEntry,
  onMergeWithPrev,
  onMergeWithNext,
  onDownloadFfmpeg,
}: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep refs in sync for the RAF loop (avoids stale closures)
  const peaksRef = useRef(peaks);
  const durationRef = useRef(duration);
  const currentTimeRef = useRef(currentTime);
  const entriesRef = useRef(srtEntries);
  const zoomRef = useRef(10);

  const [zoom, setZoom] = useState(10); // seconds visible in viewport

  // Amplitude gain: 1.0 = "1×" display = internal raw multiplier of 8
  // Slider: 0.25× to 4× (step 0.25). Actual multiplier applied = amplitudeGain * 8.
  const [amplitudeGain, setAmplitudeGain] = useState(1);
  const amplitudeGainRef = useRef(1);

  // Playhead mode: 'moving' = cursor slides across screen, waveform jumps at segment ends
  //               'fixed'  = cursor stays at 25% from left, waveform scrolls continuously
  const [playheadMode, setPlayheadMode] = useState<'moving' | 'fixed'>('moving');
  const playheadModeRef = useRef<'moving' | 'fixed'>('moving');

  // Waveform panel height (px), resizable by drag
  const [waveformHeight, setWaveformHeight] = useState(96);
  const resizeDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragTarget | null>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => { peaksRef.current = peaks; }, [peaks]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { entriesRef.current = srtEntries; }, [srtEntries]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { amplitudeGainRef.current = amplitudeGain; }, [amplitudeGain]);
  useEffect(() => { playheadModeRef.current = playheadMode; }, [playheadMode]);

  // ── Canvas drawing RAF loop ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animId: number;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { animId = requestAnimationFrame(draw); return; }

      const W = canvas.width;
      const H = canvas.height;
      const curPeaks = peaksRef.current;
      const dur = durationRef.current;
      const curTime = currentTimeRef.current;
      const entries = entriesRef.current;
      const z = zoomRef.current;

      // Scroll: depends on playhead mode
      // 'moving' — waveform is quantized to zoom-width pages; cursor moves across
      // 'fixed'  — cursor stays at 25% from left; waveform scrolls continuously
      const mode = playheadModeRef.current;
      const scrollTime = mode === 'moving'
        ? Math.max(0, Math.min(dur - z, Math.floor(curTime / z) * z))
        : Math.max(0, Math.min(dur - z, curTime - z * 0.25));
      const pps = W / z; // pixels per second

      // ── Clear ──────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      // ── Background ────────────────────────────────────────────────────────
      ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-bg-waveform') || '#1a1a2e';
      ctx.fillRect(0, 0, W, H);

      const waveH = H * 0.72;
      const regionTop = H * 0.72;
      const regionH = H * 0.28;

      // ── Waveform peaks ─────────────────────────────────────────────────────
      if (curPeaks && dur > 0) {
        const peaksPerSec = curPeaks.length / dur;
        const isDark = document.documentElement.classList.contains('dark');
        ctx.fillStyle = isDark ? '#6366f1' : '#4f46e5';
        const gain = amplitudeGainRef.current * 8;

        for (let px = 0; px < W; px++) {
          const t = scrollTime + px / pps;
          const i = Math.floor(t * peaksPerSec);
          const peak = (i >= 0 && i < curPeaks.length) ? curPeaks[i] : 0;
          const barH = Math.min(peak * waveH * 0.92 * gain, waveH * 0.98);
          ctx.fillRect(px, (waveH - barH) / 2, 1, barH);
        }
      } else if (waveformStatus === 'idle' && ffmpegStatus === 'available') {
        // Placeholder grid
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, waveH / 2);
        ctx.lineTo(W, waveH / 2);
        ctx.stroke();
      }

      // ── Time tick marks ───────────────────────────────────────────────────
      const tickInterval = z <= 10 ? 1 : z <= 30 ? 5 : z <= 60 ? 10 : 30;
      const firstTick = Math.ceil(scrollTime / tickInterval) * tickInterval;
      ctx.strokeStyle = '#374151';
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px monospace';
      ctx.lineWidth = 1;
      for (let t = firstTick; t < scrollTime + z; t += tickInterval) {
        const x = Math.round((t - scrollTime) * pps);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 4); ctx.stroke();
        const label = formatTickTime(t);
        ctx.fillText(label, x + 2, 11);
      }

      // ── Subtitle regions ──────────────────────────────────────────────────
      entries.forEach((entry, idx) => {
        const x1 = (entry.startMs / 1000 - scrollTime) * pps;
        const x2 = (entry.endMs / 1000 - scrollTime) * pps;
        if (x2 < 0 || x1 > W) return;

        const clampedX1 = Math.max(0, x1);
        const clampedX2 = Math.min(W, x2);

        // Region fill — semi-transparent
        ctx.fillStyle = `rgba(99,102,241,0.16)`;
        ctx.fillRect(clampedX1, regionTop, clampedX2 - clampedX1, regionH);

        // Borders (start / end lines)
        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = 2;

        if (x1 >= 0 && x1 <= W) {
          ctx.beginPath(); ctx.moveTo(x1, regionTop); ctx.lineTo(x1, H); ctx.stroke();
          // Drag handle knob
          ctx.fillStyle = '#818cf8';
          ctx.fillRect(x1 - 3, regionTop, 6, 10);
        }
        if (x2 >= 0 && x2 <= W) {
          ctx.beginPath(); ctx.moveTo(x2, regionTop); ctx.lineTo(x2, H); ctx.stroke();
          ctx.fillStyle = '#818cf8';
          ctx.fillRect(x2 - 3, regionTop, 6, 10);
        }

        // Text overlay — show truncated original text inside the region
        const regionWidth = clampedX2 - clampedX1;
        if (regionWidth > 24 && clampedX1 < W) {
          ctx.save();
          // Clip to region so text doesn't spill over
          ctx.beginPath();
          ctx.rect(clampedX1 + 1, regionTop + 12, regionWidth - 2, regionH - 14);
          ctx.clip();
          ctx.fillStyle = 'rgba(224,231,255,0.85)';
          ctx.font = '10px sans-serif';
          const displayText = entry.originalText.replace(/\n/g, ' ');
          ctx.fillText(displayText, clampedX1 + 4, regionTop + regionH * 0.62, regionWidth - 8);
          ctx.restore();

          // Index label (top-left corner)
          ctx.fillStyle = '#c7d2fe';
          ctx.font = '9px monospace';
          ctx.fillText(`#${idx + 1}`, clampedX1 + 3, regionTop + 10);
        }
      });

      // ── Playhead ──────────────────────────────────────────────────────────
      const ph = (curTime - scrollTime) * pps;
      if (ph >= 0 && ph <= W) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ph, 0); ctx.lineTo(ph, H); ctx.stroke();
        // Triangle at top
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(ph - 5, 0); ctx.lineTo(ph + 5, 0); ctx.lineTo(ph, 7);
        ctx.closePath(); ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [ffmpegStatus, waveformStatus]); // re-initialize only when status changes

  // ── Canvas resize observer ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        canvas.width = entry.contentRect.width;
        canvas.height = entry.contentRect.height;
      }
    });
    ro.observe(container);
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    return () => ro.disconnect();
  }, []);

  // ── Helper: pixel x → time in seconds ─────────────────────────────────────
  const xToTime = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const z = zoomRef.current;
    const dur = durationRef.current;
    const cur = currentTimeRef.current;
    const scrollTime = playheadModeRef.current === 'moving'
      ? Math.max(0, Math.min(dur - z, Math.floor(cur / z) * z))
      : Math.max(0, Math.min(dur - z, cur - z * 0.25));
    return Math.max(0, Math.min(dur, scrollTime + (x / canvas.width) * z));
  }, []);

  // ── Helper: find entry + handle at time ───────────────────────────────────
  const findHandle = useCallback(
    (timeMs: number, toleranceMs: number): { idx: number; handle: 'start' | 'end' } | null => {
      for (let i = 0; i < entriesRef.current.length; i++) {
        const e = entriesRef.current[i];
        if (Math.abs(timeMs - e.startMs) < toleranceMs) return { idx: i, handle: 'start' };
        if (Math.abs(timeMs - e.endMs) < toleranceMs) return { idx: i, handle: 'end' };
      }
      return null;
    },
    [],
  );

  const findEntryAtTime = useCallback((timeMs: number): number => {
    return entriesRef.current.findIndex(
      (e) => timeMs >= e.startMs && timeMs <= e.endMs,
    );
  }, []);

  // ── Mouse events ──────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return; // left click only
      e.preventDefault();
      isDraggingRef.current = false;

      const timeSec = xToTime(e.clientX);
      const timeMs = timeSec * 1000;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const z = zoomRef.current;
      const pps = canvas.width / z;
      const toleranceMs = (6 / pps) * 1000;

      const handle = findHandle(timeMs, toleranceMs);
      if (handle) {
        canvas.style.cursor = 'ew-resize';
        dragRef.current = {
          type: 'handle',
          entryIdx: handle.idx,
          handle: handle.handle,
          initMs: handle.handle === 'start'
            ? entriesRef.current[handle.idx].startMs
            : entriesRef.current[handle.idx].endMs,
          initX: e.clientX,
        };
        return;
      }

      // Check if click is in the subtitle region (bottom 28% of canvas)
      const rect = canvas.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const isInSubtitleRegion = relY > canvas.height * 0.72;

      if (isInSubtitleRegion) {
        const entryIdx = findEntryAtTime(timeMs);
        if (entryIdx >= 0) {
          canvas.style.cursor = 'grabbing';
          const entry = entriesRef.current[entryIdx];
          dragRef.current = {
            type: 'move',
            entryIdx,
            initStartMs: entry.startMs,
            initEndMs: entry.endMs,
            initX: e.clientX,
          };
          return;
        }
      }

      canvas.style.cursor = 'crosshair';
      dragRef.current = { type: 'seek' };
      onSeek(timeSec);
    },
    [xToTime, findHandle, findEntryAtTime, onSeek],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (!dragRef.current) {
        // ── Hover cursor: update based on what's under the mouse ────────────
        const timeSec = xToTime(e.clientX);
        const timeMs = timeSec * 1000;
        const z = zoomRef.current;
        const pps = canvas.width / z;
        const toleranceMs = (8 / pps) * 1000;
        const rect = canvas.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        const isInSubtitleRegion = relY > canvas.height * 0.72;

        const handle = findHandle(timeMs, toleranceMs);
        if (handle) {
          canvas.style.cursor = 'ew-resize';
        } else if (isInSubtitleRegion && findEntryAtTime(timeMs) >= 0) {
          canvas.style.cursor = 'grab';
        } else {
          canvas.style.cursor = 'crosshair';
        }
        return;
      }

      isDraggingRef.current = true;

      if (dragRef.current.type === 'seek') {
        onSeek(xToTime(e.clientX));
      } else if (dragRef.current.type === 'handle') {
        const d = dragRef.current;
        const timeSec = xToTime(e.clientX);
        const rawMs = Math.round(timeSec * 1000);
        const entries = entriesRef.current;
        const entry = entries[d.entryIdx];

        let clampedMs: number;
        if (d.handle === 'start') {
          // 开始时间：不能早于上一条的结束时间，不能晚于本条结束时间 - 100ms
          const minMs = d.entryIdx > 0 ? entries[d.entryIdx - 1].endMs : 0;
          clampedMs = Math.max(minMs, Math.min(entry.endMs - 100, rawMs));
        } else {
          // 结束时间：不能晚于下一条的开始时间，不能早于本条开始时间 + 100ms
          const maxMs =
            d.entryIdx < entries.length - 1
              ? entries[d.entryIdx + 1].startMs
              : durationRef.current * 1000;
          clampedMs = Math.min(maxMs, Math.max(entry.startMs + 100, rawMs));
        }
        onEntryUpdate(d.entryIdx, { [d.handle === 'start' ? 'startMs' : 'endMs']: clampedMs });
      } else if (dragRef.current.type === 'move') {
        // Shift entire subtitle (start + end) by the drag delta
        const d = dragRef.current;
        const z = zoomRef.current;
        const pps = canvas.width / z;
        const deltaMs = Math.round(((e.clientX - d.initX) / pps) * 1000);
        const subtitleDuration = d.initEndMs - d.initStartMs;
        const entries = entriesRef.current;
        const prevEndMs = d.entryIdx > 0 ? entries[d.entryIdx - 1].endMs : 0;
        const nextStartMs =
          d.entryIdx < entries.length - 1
            ? entries[d.entryIdx + 1].startMs
            : durationRef.current * 1000;

        const newStart = Math.max(
          prevEndMs,
          Math.min(nextStartMs - subtitleDuration, d.initStartMs + deltaMs)
        );
        const newEnd = newStart + subtitleDuration;
        onEntryUpdate(d.entryIdx, { startMs: newStart, endMs: newEnd });
        canvas.style.cursor = 'grabbing';
      }
    },
    [xToTime, findHandle, findEntryAtTime, onSeek, onEntryUpdate],
  );

  const handleMouseUp = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas && dragRef.current) {
      canvas.style.cursor = 'crosshair';
    }
    dragRef.current = null;
  }, []);

  const handleContextMenu = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      setContextMenu(null);
      const timeSec = xToTime(e.clientX);
      const timeMs = timeSec * 1000;
      // Use viewport coordinates so the menu can use position:fixed and escape overflow:hidden
      const menuX = e.clientX;
      const menuY = e.clientY;

      const entryIdx = findEntryAtTime(timeMs);
      if (entryIdx >= 0) {
        setContextMenu({ x: menuX, y: menuY, type: 'entry', entryIdx });
      } else {
        setContextMenu({ x: menuX, y: menuY, type: 'empty', timeMs });
      }
    },
    [xToTime, findEntryAtTime],
  );

  // Dismiss context menu when clicking outside the menu
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (e: globalThis.MouseEvent) => {
      // If the click target is inside the menu, let the menu handle it
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [contextMenu]);

  // ── Zoom controls ─────────────────────────────────────────────────────────
  const zoomIn = () => setZoom((z) => Math.max(ZOOM_MIN, z - 5));
  const zoomOut = () => setZoom((z) => Math.min(ZOOM_MAX, z + 5));

  // ── Waveform resize handle ─────────────────────────────────────────────────
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeDragRef.current = { startY: e.clientY, startH: waveformHeight };

    const onMove = (ev: globalThis.MouseEvent) => {
      if (!resizeDragRef.current) return;
      const delta = ev.clientY - resizeDragRef.current.startY;
      setWaveformHeight(Math.max(48, Math.min(300, resizeDragRef.current.startH + delta)));
    };
    const onUp = () => {
      resizeDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [waveformHeight]);

  // ── Render ────────────────────────────────────────────────────────────────
  const showFfmpegBanner = ffmpegStatus === 'not-found' || ffmpegStatus === 'downloading';

  return (
    <div className="flex flex-col border-t border-border/60">
      {/* FFmpeg banner */}
      {showFfmpegBanner && (
        <div className="flex items-center gap-3 px-3 py-2 bg-amber-500/10 border-b border-amber-500/30 text-sm">
          <span className="text-amber-400 flex-1">{t.translationPage.ffmpegNotFound}</span>
          {ffmpegStatus === 'not-found' && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
              onClick={onDownloadFfmpeg}
            >
              <Download className="h-3 w-3 mr-1" />
              {t.translationPage.downloadFfmpeg}
            </Button>
          )}
          {ffmpegStatus === 'downloading' && (
            <span className="text-amber-400 text-xs">{t.translationPage.downloadFfmpeg}…</span>
          )}
        </div>
      )}

      {/* Waveform + controls */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/40">
        <span className="text-xs text-muted-foreground/60 select-none">{t.translationPage.zoom}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={zoomIn} title={t.translationPage.zoomIn}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground font-mono w-8 text-center select-none">{zoom}s</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={zoomOut} title={t.translationPage.zoomOut}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>

        {/* Amplitude gain slider */}
        <div className="flex items-center gap-1 ml-2 border-l border-border/40 pl-2">
          <span className="text-xs text-muted-foreground/60 select-none">振幅</span>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.25}
            value={amplitudeGain}
            onChange={(e) => setAmplitudeGain(Number(e.target.value))}
            className="w-20 h-1 cursor-pointer accent-indigo-500"
            title={`振幅增益: ${amplitudeGain}×`}
          />
          <span className="text-xs text-muted-foreground/60 font-mono w-6 select-none">{amplitudeGain}×</span>
        </div>

        {/* Playhead mode toggle */}
        <button
          type="button"
          onClick={() => setPlayheadMode((m) => m === 'moving' ? 'fixed' : 'moving')}
          title={playheadMode === 'moving' ? '播放头: 横向移动 (点击切换为固定)' : '播放头: 固定居左 (点击切换为移动)'}
          className={`ml-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border transition-colors select-none ${
            playheadMode === 'moving'
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-border/50 text-muted-foreground hover:text-foreground'
          }`}
        >
          {playheadMode === 'moving' ? '↔ 移动' : '⊣ 固定'}
        </button>

        {waveformStatus === 'loading' && (
          <span className="text-xs text-muted-foreground ml-2 animate-pulse">
            {t.translationPage.extractingWaveform}
          </span>
        )}
        {waveformStatus === 'error' && waveformError && (
          <span className="text-xs text-destructive ml-2">{waveformError}</span>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative w-full bg-[#0f1117] cursor-crosshair overflow-hidden"
        style={{ height: waveformHeight }}
        onMouseLeave={handleMouseUp}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onContextMenu={handleContextMenu}
        />

        {/* Loading overlay */}
        {waveformStatus === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="text-xs text-muted-foreground animate-pulse">
              {t.translationPage.extractingWaveform}
            </span>
          </div>
        )}

        {/* Context menu — rendered with position:fixed so it escapes overflow:hidden clipping */}
        {contextMenu && (
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[160px] bg-card border border-border rounded-md shadow-lg py-1 text-sm"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 180),
              top: Math.min(contextMenu.y, window.innerHeight - 140),
            }}
          >
            {contextMenu.type === 'empty' && (
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors"
                onClick={() => {
                  onInsertEntry(contextMenu.timeMs!);
                  // Seek to the inserted position so the table auto-scrolls to it
                  onSeek(contextMenu.timeMs! / 1000);
                  setContextMenu(null);
                }}
              >
                {t.translationPage.insertSubtitle}
              </button>
            )}
            {contextMenu.type === 'entry' && (
              <>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors"
                  onClick={() => { onMergeWithPrev(contextMenu.entryIdx!); setContextMenu(null); }}
                >
                  {t.translationPage.mergePrev}
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors"
                  onClick={() => { onMergeWithNext(contextMenu.entryIdx!); setContextMenu(null); }}
                >
                  {t.translationPage.mergeNext}
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-destructive/10 text-destructive transition-colors"
                  onClick={() => { onDeleteEntry(contextMenu.entryIdx!); setContextMenu(null); }}
                >
                  {t.translationPage.deleteSubtitle}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="h-1.5 w-full cursor-row-resize bg-border/40 hover:bg-primary/40 transition-colors select-none flex items-center justify-center"
        onMouseDown={handleResizeMouseDown}
        title="拖动调整波形高度"
      >
        <div className="w-8 h-0.5 rounded-full bg-border/60" />
      </div>
    </div>
  );
}

function formatTickTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
