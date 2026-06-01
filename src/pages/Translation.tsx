import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronUp,
  ChevronDown,
  Download,
  MoreVertical,
  Film,
  FileText,
  CheckCircle2,
  X,
  BookOpen,
  Plus,
  Trash2,
} from 'lucide-react';
import { WaveformDisplay, type SrtEntry } from '@/components/WaveformDisplay';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ── Time helpers ────────────────────────────────────────────────────────────

function srtTimeToMs(t: string): number {
  const parts = t.replace(',', '.').split(':');
  const secMs = parts[2].split('.');
  return (
    parseInt(parts[0]) * 3600000 +
    parseInt(parts[1]) * 60000 +
    parseInt(secMs[0]) * 1000 +
    parseInt((secMs[1] || '0').padEnd(3, '0').slice(0, 3))
  );
}

function msToSrtTime(ms: number): string {
  const c = Math.max(0, Math.round(ms));
  const h = Math.floor(c / 3600000);
  const m = Math.floor((c % 3600000) / 60000);
  const s = Math.floor((c % 60000) / 1000);
  const mil = c % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mil).padStart(3, '0')}`;
}

function formatTimecode(ms: number): string {
  const c = Math.max(0, ms);
  const m = Math.floor(c / 60000);
  const s = Math.floor((c % 60000) / 1000);
  const cs = Math.floor((c % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Glossary ─────────────────────────────────────────────────────────────────

interface GlossaryEntry {
  id: string;
  original: string;
  translation: string;
  notes: string;
}

function GlossaryDialog({
  rows,
  onRowsChange,
  onClose,
}: {
  rows: GlossaryEntry[];
  onRowsChange: (rows: GlossaryEntry[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tp = t.translationPage;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addRow = () => {
    onRowsChange([...rows, { id: crypto.randomUUID(), original: '', translation: '', notes: '' }]);
  };

  const deleteRow = (id: string) => {
    onRowsChange(rows.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, field: keyof Omit<GlossaryEntry, 'id'>, value: string) => {
    onRowsChange(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
      // Skip header line if it looks like a known header (starts with tab-separated text)
      const firstLine = lines[0] ?? '';
      const hasHeader = firstLine.includes('\t') && !/^[\w\s]+$/.test(firstLine.split('\t')[0]);
      // Heuristic: if the first cell isn't a "plain word" it's probably a header
      const start = (firstLine.startsWith('原文\t') || firstLine.startsWith('Original\t')) ? 1 : 0;
      const imported: GlossaryEntry[] = lines.slice(hasHeader ? (start > 0 ? start : 0) : start).map((line) => {
        const parts = line.split('\t');
        return {
          id: crypto.randomUUID(),
          original: parts[0] ?? '',
          translation: parts[1] ?? '',
          notes: parts[2] ?? '',
        };
      });
      onRowsChange(imported);
    });
    e.target.value = '';
  };

  const handleExport = () => {
    // Use i18n column names in the header so it round-trips in the same language
    const header = `${tp.glossaryColOriginal}\t${tp.glossaryColTranslation}\t${tp.glossaryColNotes}`;
    const body = rows.map((r) => `${r.original}\t${r.translation}\t${r.notes}`).join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'glossary.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Close on Escape key
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-[720px] max-w-[92vw] max-h-[80vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">{tp.glossaryTitle}</span>
          <div className="flex-1" />
          <input ref={fileInputRef} type="file" accept=".txt" className="sr-only" onChange={handleImport} />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileInputRef.current?.click()}>
            {tp.glossaryImport}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExport} disabled={rows.length === 0}>
            <Download className="h-3 w-3 mr-1" />{tp.glossaryExport}
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={addRow}>
            <Plus className="h-3 w-3 mr-1" />{tp.glossaryAddRow}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_1fr_1fr_32px] border-b border-border bg-muted/30 text-xs text-muted-foreground select-none flex-shrink-0">
          <div className="px-3 py-2 font-medium border-r border-border/40">{tp.glossaryColOriginal}</div>
          <div className="px-3 py-2 font-medium border-r border-border/40">{tp.glossaryColTranslation}</div>
          <div className="px-3 py-2 font-medium border-r border-border/40">{tp.glossaryColNotes}</div>
          <div />
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-muted-foreground">
              <BookOpen className="h-8 w-8 opacity-25" />
              <p className="text-sm">{tp.glossaryEmpty}</p>
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[1fr_1fr_1fr_32px] border-b border-border/40 hover:bg-muted/10 group"
              >
                <input
                  value={row.original}
                  onChange={(e) => updateRow(row.id, 'original', e.target.value)}
                  className="px-3 py-1.5 text-sm bg-transparent focus:outline-none focus:bg-muted/20 border-r border-border/30"
                  placeholder={tp.glossaryPlaceholderOriginal}
                />
                <input
                  value={row.translation}
                  onChange={(e) => updateRow(row.id, 'translation', e.target.value)}
                  className="px-3 py-1.5 text-sm bg-transparent focus:outline-none focus:bg-muted/20 border-r border-border/30"
                  placeholder={tp.glossaryPlaceholderTranslation}
                />
                <input
                  value={row.notes}
                  onChange={(e) => updateRow(row.id, 'notes', e.target.value)}
                  className="px-3 py-1.5 text-sm bg-transparent focus:outline-none focus:bg-muted/20 border-r border-border/30"
                  placeholder={tp.glossaryPlaceholderNotes}
                />
                <button
                  type="button"
                  onClick={() => deleteRow(row.id)}
                  className="flex items-center justify-center opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:text-destructive transition-all"
                  title={tp.glossaryDeleteRow}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground flex-shrink-0">
          {tp.glossaryCount.replace('{count}', String(rows.length))}
        </div>
      </div>
    </div>
  );
}

// ── SRT parser ──────────────────────────────────────────────────────────────

/** Returns true if the string contains at least one CJK / Han character. */
function hasCjk(s: string): boolean {
  return /[\u4E00-\u9FFF\u3400-\u4DBF]/u.test(s);
}

/**
 * Split a multi-line body (lines after the timestamp) into originalText and translatedText.
 *
 * Rules:
 *  - If all lines lack CJK, everything is treated as original (no translation yet).
 *  - If some lines have CJK and some don't, CJK lines → translated, others → original.
 *  - If all lines have CJK, everything is treated as original (can't distinguish).
 *  - Translation may appear before OR after the original in the file.
 */
function splitBilingual(bodyLines: string[]): { original: string; translated: string } {
  const nonEmpty = bodyLines.filter((l) => l.trim() !== '');
  if (nonEmpty.length === 0) return { original: '', translated: '' };
  if (nonEmpty.length === 1) return { original: nonEmpty[0], translated: '' };

  const origLines: string[] = [];
  const transLines: string[] = [];
  for (const line of nonEmpty) {
    if (hasCjk(line)) transLines.push(line);
    else origLines.push(line);
  }

  // Cannot distinguish (all CJK or no CJK): treat as original only
  if (origLines.length === 0 || transLines.length === 0) {
    return { original: nonEmpty.join('\n'), translated: '' };
  }
  return { original: origLines.join('\n'), translated: transLines.join('\n') };
}

function parseSrt(content: string): SrtEntry[] {
  // Normalize all line endings to LF so the block-split regex works on CRLF files
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n{2,}/);
  const entries: SrtEntry[] = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const index = parseInt(lines[0]);
    const m = lines[1].match(
      /(\d{2}:\d{2}:\d{2}[,.:]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.:]\d{3})/,
    );
    if (!m) continue;
    const { original, translated } = splitBilingual(lines.slice(2));
    entries.push({
      index,
      startMs: srtTimeToMs(m[1]),
      endMs: srtTimeToMs(m[2]),
      originalText: original,
      translatedText: translated,
    });
  }
  return entries;
}

function exportSrt(entries: SrtEntry[], mode: 'original' | 'translation' | 'bilingual'): string {
  return entries
    .map((e) => {
      const text =
        mode === 'original'
          ? e.originalText
          : mode === 'translation'
          ? e.translatedText || e.originalText
          : `${e.originalText}\n${e.translatedText || ''}`;
      return `${e.index}\n${msToSrtTime(e.startMs)} --> ${msToSrtTime(e.endMs)}\n${text}`;
    })
    .join('\n\n');
}

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Entry helpers ────────────────────────────────────────────────────────────

function mergeEntries(entries: SrtEntry[], idx: number, dir: 'prev' | 'next'): SrtEntry[] {
  const a = dir === 'prev' ? idx - 1 : idx;
  const b = a + 1;
  if (a < 0 || b >= entries.length) return entries;
  const join = (x: string, y: string) =>
    x.trimEnd() +
    (!x.trimEnd().endsWith(' ') && !y.trimStart().startsWith(' ') ? ' ' : '') +
    y.trimStart();
  const merged: SrtEntry = {
    index: entries[a].index,
    startMs: entries[a].startMs,
    endMs: entries[b].endMs,
    originalText: join(entries[a].originalText, entries[b].originalText),
    translatedText: join(entries[a].translatedText, entries[b].translatedText),
  };
  return [...entries.slice(0, a), merged, ...entries.slice(b + 1)].map((e, i) => ({
    ...e,
    index: i + 1,
  }));
}

function insertEntry(entries: SrtEntry[], atMs: number): SrtEntry[] {
  // Find the next entry that starts after the insertion point
  const nextEntry = entries.find((e) => e.startMs > atMs);
  // Cap end at min(2 s, nextEntry.startMs - 1 frame@30fps)
  const maxEndMs = nextEntry ? nextEntry.startMs - 33 : atMs + 2000;
  const endMs = Math.min(atMs + 2000, maxEndMs);
  // Need at least 1 frame of duration; skip insert if gap is too small
  if (endMs < atMs + 33) return entries;
  const n: SrtEntry = { index: 0, startMs: atMs, endMs, originalText: '', translatedText: '' };
  const i = entries.findIndex((e) => e.startMs > atMs);
  const next = i >= 0 ? [...entries.slice(0, i), n, ...entries.slice(i)] : [...entries, n];
  return next.map((e, j) => ({ ...e, index: j + 1 }));
}

function deleteEntry(entries: SrtEntry[], idx: number): SrtEntry[] {
  return entries.filter((_, i) => i !== idx).map((e, i) => ({ ...e, index: i + 1 }));
}

function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// ── Types ────────────────────────────────────────────────────────────────────

type SubtitleMode = 'original' | 'translated' | 'both' | 'none';
type FFmpegStatus = 'checking' | 'available' | 'not-found' | 'downloading';
type WaveformStatus = 'idle' | 'loading' | 'ready' | 'error';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// ── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({
  label,
  hint,
  isOver,
  isLoaded,
  loadedName,
  icon,
  zoneRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onBrowse,
  onClear,
}: {
  label: string;
  hint: string;
  isOver: boolean;
  isLoaded: boolean;
  loadedName: string;
  icon: React.ReactNode;
  zoneRef?: React.RefObject<HTMLDivElement | null>;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  onBrowse: () => void;
  onClear?: () => void;
}) {
  return (
    <div
      ref={zoneRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onBrowse}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onBrowse(); }}
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer select-none ${
        isOver
          ? 'border-primary bg-primary/10 text-primary'
          : isLoaded
          ? 'border-green-500/50 bg-green-500/5'
          : 'border-border/60 text-muted-foreground hover:border-primary/50 hover:bg-primary/5'
      }`}
    >
      {isLoaded ? (
        <>
          <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0" />
          <p className="text-sm font-medium text-foreground break-all px-2 leading-snug">{loadedName}</p>
          {onClear && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />
              移除
            </button>
          )}
        </>
      ) : (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs opacity-70 mt-1">{hint}</p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TranslationPage() {
  const { t } = useI18n();
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);

  // Video / SRT state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null); // Tauri 文件系统路径
  const [srtEntries, setSrtEntries] = useState<SrtEntry[]>([]);
  const [srtFilename, setSrtFilename] = useState('');
  const [videoFilename, setVideoFilename] = useState('');

  // Drop zone refs for Tauri position-based detection
  const videoZoneRef = useRef<HTMLDivElement>(null);
  const srtZoneRef = useRef<HTMLDivElement>(null);
  const activeDragZoneRef = useRef<'video' | 'srt' | null>(null);

  // Player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(2);
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>('both');
  const [subtitleOffsetPct, setSubtitleOffsetPct] = useState(8);

  // Drag state
  const [videoDragOver, setVideoDragOver] = useState(false);
  const [srtDragOver, setSrtDragOver] = useState(false);

  // Waveform / FFmpeg
  const [ffmpegStatus, setFfmpegStatus] = useState<FFmpegStatus>('checking');
  const [waveformStatus, setWaveformStatus] = useState<WaveformStatus>('idle');
  const [waveformError, setWaveformError] = useState<string | undefined>();
  const [peaks, setPeaks] = useState<Float32Array | null>(null);

  // Active subtitle + auto-scroll
  const currentMs = currentTime * 1000;
  // Use strict less-than for endMs so boundary between adjacent entries resolves to the later entry
  const activeIdx = srtEntries.findIndex((e) => currentMs >= e.startMs && currentMs < e.endMs);
  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  // Table context menu
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number; idx: number } | null>(null);

  // Glossary
  const [showGlossary, setShowGlossary] = useState(false);

  // Exit guard
  const [showExitDialog, setShowExitDialog] = useState(false);
  const isDirtyRef = useRef(false);
  const pendingCloseRef = useRef<(() => Promise<void>) | null>(null);
  const isForceClosingRef = useRef(false);
  const [glossaryRows, setGlossaryRows] = useState<GlossaryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('qafone-glossary');
      return saved ? (JSON.parse(saved) as GlossaryEntry[]) : [];
    } catch {
      return [];
    }
  });

  // Persist glossary to localStorage
  useEffect(() => {
    try { localStorage.setItem('qafone-glossary', JSON.stringify(glossaryRows)); }
    catch { /* quota */ }
  }, [glossaryRows]);

  // Tauri window close guard — show confirmation when there are unsaved subtitle entries
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested((event) => {
        // Let native close proceed unless there are unsaved subtitle edits.
        if (isForceClosingRef.current || !isDirtyRef.current) return;

        event.preventDefault();
        pendingCloseRef.current = async () => {
          isForceClosingRef.current = true;
          await appWindow.close();
        };
        setShowExitDialog(true);
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  // Auto-save
  useEffect(() => {
    if (srtEntries.length === 0) return;
    try { localStorage.setItem('qafone-translation-entries', JSON.stringify(srtEntries)); }
    catch { /* quota */ }
  }, [srtEntries]);

  // Load SRT from subtitle extraction page (via sessionStorage)
  useEffect(() => {
    const pending = sessionStorage.getItem('qafone-pending-srt');
    if (!pending) return;
    sessionStorage.removeItem('qafone-pending-srt');
    const parsed = parseSrt(pending);
    if (parsed.length > 0) {
      setSrtEntries(parsed);
      setSrtFilename('subtitles.srt');
      isDirtyRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to active
  useEffect(() => {
    if (activeIdx < 0) return;
    rowRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIdx]);

  // Auto-resize all textareas when entries change (handles programmatic edits & merges)
  useEffect(() => {
    textareaRefs.current.forEach((el) => autoResize(el));
  }, [srtEntries]);

  // Check FFmpeg
  useEffect(() => {
    invoke<boolean>('check_ffmpeg_status')
      .then((ok) => setFfmpegStatus(ok ? 'available' : 'not-found'))
      .catch(() => setFfmpegStatus('not-found'));
  }, []);

  // Extract waveform when video + FFmpeg ready
  useEffect(() => {
    if (ffmpegStatus !== 'available' || duration <= 0) return;
    // 优先使用 Tauri 日志路径，其次使用 File 对象上的 path 属性
    const filePath = videoFilePath ?? (videoFile as File & { path?: string } | null)?.path;
    if (!filePath) return;
    setWaveformStatus('loading');
    setWaveformError(undefined);
    invoke<number[]>('extract_waveform', { videoPath: filePath, samplesPerSecond: 100 })
      .then((data) => { setPeaks(new Float32Array(data)); setWaveformStatus('ready'); })
      .catch((err) => { setWaveformStatus('error'); setWaveformError(String(err)); });
  }, [videoFile, videoFilePath, ffmpegStatus, duration]);

  // Spacebar shortcut
  const handlePlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  }, []);

  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); handlePlayPause(); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [handlePlayPause]);

  // Table menu dismiss
  useEffect(() => {
    if (!tableMenu) return;
    const d = () => setTableMenu(null);
    document.addEventListener('click', d, { capture: true });
    return () => document.removeEventListener('click', d, { capture: true });
  }, [tableMenu]);

  // Derived: subtitle overlay text
  const activeEntry = activeIdx >= 0 ? srtEntries[activeIdx] : null;
  const overlayLines: string[] = [];
  if (activeEntry) {
    if (subtitleMode === 'original') overlayLines.push(activeEntry.originalText);
    else if (subtitleMode === 'translated')
      overlayLines.push(activeEntry.translatedText || activeEntry.originalText);
    else if (subtitleMode === 'both') {
      overlayLines.push(activeEntry.originalText);
      if (activeEntry.translatedText) overlayLines.push(activeEntry.translatedText);
    }
  }

  // Handlers
  const handleSeek = useCallback((time: number) => {
    const v = videoRef.current;
    if (v) { v.currentTime = time; setCurrentTime(time); }
  }, []);

  // ── Tauri 原生拖放（包含多区域判断） ─────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      unlisten = await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
        // Only handle events when this page is active
        if (locationRef.current !== '/translation') return;

        const { type } = event.payload;

        if ((type === 'enter' || type === 'over') && 'position' in event.payload) {
          const pos = event.payload.position;
          const cssX = pos.x / window.devicePixelRatio;
          const cssY = pos.y / window.devicePixelRatio;
          const vRect = videoZoneRef.current?.getBoundingClientRect();
          const sRect = srtZoneRef.current?.getBoundingClientRect();
          const inVideo = vRect && cssX >= vRect.left && cssX <= vRect.right && cssY >= vRect.top && cssY <= vRect.bottom;
          const inSrt = sRect && cssX >= sRect.left && cssX <= sRect.right && cssY >= sRect.top && cssY <= sRect.bottom;
          setVideoDragOver(!!inVideo);
          setSrtDragOver(!!inSrt);
          activeDragZoneRef.current = inVideo ? 'video' : inSrt ? 'srt' : null;
        } else if (type === 'leave') {
          setVideoDragOver(false);
          setSrtDragOver(false);
          activeDragZoneRef.current = null;
        } else if (type === 'drop' && 'paths' in event.payload) {
          const paths = event.payload.paths;
          const zone = activeDragZoneRef.current;
          setVideoDragOver(false);
          setSrtDragOver(false);
          activeDragZoneRef.current = null;

          for (const filePath of paths) {
            const lower = filePath.toLowerCase();
            const isSrt = lower.endsWith('.srt') || lower.endsWith('.vtt');
            const isVideo = !isSrt;

            if (isVideo && (zone === 'video' || zone === null)) {
              // 视频文件：用 convertFileSrc 生成可播放 URL
              const url = convertFileSrc(filePath);
              if (videoUrl) URL.revokeObjectURL(videoUrl);
              const name = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
              setVideoFilePath(filePath);
              setVideoFile(null);
              setVideoUrl(url);
              setVideoFilename(name);
              setPeaks(null);
              setWaveformStatus('idle');
              setCurrentTime(0);
              setIsPlaying(false);
            } else if (isSrt && (zone === 'srt' || zone === null)) {
              // SRT 文件：通过 asset 协议 fetch 读取内容
              try {
                const url = convertFileSrc(filePath);
                const text = await fetch(url).then((r) => r.text());
                const parsed = parseSrt(text);
                const name = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
                setSrtEntries(parsed);
                setSrtFilename(name);
                isDirtyRef.current = true;
              } catch (e) {
                console.error('Failed to read SRT:', e);
              }
            }
          }
        }
      });
    })();
    return () => { unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  const seek = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => {
      const next = (i + 1) % SPEEDS.length;
      if (videoRef.current) videoRef.current.playbackRate = SPEEDS[next];
      return next;
    });
  }, []);

  const handleVideoDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setVideoDragOver(false);
    if (isTauri()) return; // 由 Tauri 原生事件处理
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoFilePath(null);
    setVideoUrl(URL.createObjectURL(file));
    setVideoFilename(file.name);
    setPeaks(null);
    setWaveformStatus('idle');
    setCurrentTime(0);
    setIsPlaying(false);
  }, [videoUrl]);

  const handleSrtDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setSrtDragOver(false);
    if (isTauri()) return; // 由 Tauri 原生事件处理
    const file = e.dataTransfer.files[0];
    if (!file) return;
    file.text().then((text) => {
      const parsed = parseSrt(text);
      setSrtEntries(parsed);
      setSrtFilename(file.name);
      isDirtyRef.current = true;
    });
  }, []);

  // 点击浏览——视频文件
  const handleBrowseVideo = useCallback(async () => {
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const path = await open({
        multiple: false,
        filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'ts', 'wmv', 'm4v', 'webm'] }],
      });
      if (typeof path === 'string' && path) {
        const url = convertFileSrc(path);
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
        setVideoFilePath(path);
        setVideoFile(null);
        setVideoUrl(url);
        setVideoFilename(name);
        setPeaks(null);
        setWaveformStatus('idle');
        setCurrentTime(0);
        setIsPlaying(false);
      }
    } else {
      videoInputRef.current?.click();
    }
  }, [videoUrl]);

  // 点击浏览——SRT 文件
  const handleBrowseSrt = useCallback(async () => {
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const path = await open({
        multiple: false,
        filters: [{ name: 'Subtitle', extensions: ['srt', 'vtt'] }],
      });
      if (typeof path === 'string' && path) {
        try {
          const url = convertFileSrc(path);
          const text = await fetch(url).then((r) => r.text());
          const parsed = parseSrt(text);
          const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
          setSrtEntries(parsed);
          setSrtFilename(name);
          isDirtyRef.current = true;
        } catch (e) {
          console.error('Failed to read SRT:', e);
        }
      }
    } else {
      srtInputRef.current?.click();
    }
  }, []);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  const handleVideoFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoFilePath(null);
    setVideoUrl(URL.createObjectURL(file));
    setVideoFilename(file.name);
    setPeaks(null);
    setWaveformStatus('idle');
    setCurrentTime(0);
    setIsPlaying(false);
  }, [videoUrl]);

  const handleSrtFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const parsed = parseSrt(text);
      setSrtEntries(parsed);
      setSrtFilename(file.name);
      isDirtyRef.current = true;
    });
  }, []);

  const handleOriginalChange = (idx: number, value: string) => {
    isDirtyRef.current = true;
    setSrtEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, originalText: value } : e)));
  };

  const handleTranslationChange = (idx: number, value: string) => {
    isDirtyRef.current = true;
    setSrtEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, translatedText: value } : e)));
  };

  const handleEntryUpdate = (idx: number, changes: Partial<Pick<SrtEntry, 'startMs' | 'endMs'>>) => {
    isDirtyRef.current = true;
    setSrtEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...changes } : e)));
  };

  const handleInsertEntry = (startMs: number) => { isDirtyRef.current = true; setSrtEntries((p) => insertEntry(p, startMs)); };
  const handleDeleteEntry = (idx: number) => { isDirtyRef.current = true; setSrtEntries((p) => deleteEntry(p, idx)); };
  const handleMergeWithPrev = (idx: number) => { isDirtyRef.current = true; setSrtEntries((p) => mergeEntries(p, idx, 'prev')); };
  const handleMergeWithNext = (idx: number) => { isDirtyRef.current = true; setSrtEntries((p) => mergeEntries(p, idx, 'next')); };

  const handleDownloadFfmpeg = useCallback(() => {
    setFfmpegStatus('downloading');
    invoke('download_ffmpeg')
      .then(() => setFfmpegStatus('available'))
      .catch(() => setFfmpegStatus('not-found'));
  }, []);

  const clearVideo = useCallback(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setVideoFile(null);
    setVideoFilePath(null);
    setVideoFilename('');
    setPeaks(null);
    setWaveformStatus('idle');
    setCurrentTime(0);
    setIsPlaying(false);
  }, [videoUrl]);

  const clearSrt = useCallback(() => {
    setSrtEntries([]);
    setSrtFilename('');
  }, []);

  const hasVideo = !!videoUrl;
  const hasSrt = srtEntries.length > 0;

  // ── Drop zone view ────────────────────────────────────────────────────────
  if (!hasVideo || !hasSrt) {
    return (
      <div className="flex flex-col h-full p-6 gap-6">
        <div>
          <h1 className="text-xl font-bold">{t.translationPage.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.translationPage.subtitle}</p>
        </div>
        <div className="grid grid-cols-2 gap-4 flex-1 content-start">
          {/* hidden file inputs for browser mode */}
          <input ref={videoInputRef} type="file" accept="video/*,.mkv,.mp4,.mov,.avi,.ts,.wmv" className="sr-only" onChange={handleVideoFileChange} />
          <input ref={srtInputRef} type="file" accept=".srt,.vtt" className="sr-only" onChange={handleSrtFileChange} />
          <DropZone
            label={t.translationPage.dropVideoHere}
            hint={t.translationPage.dropVideoHint}
            isOver={videoDragOver}
            isLoaded={!!videoFilename}
            loadedName={videoFilename}
            icon={<Film className="h-6 w-6 text-muted-foreground" />}
            zoneRef={videoZoneRef}
            onDragOver={(e) => { e.preventDefault(); if (!isTauri()) setVideoDragOver(true); }}
            onDragLeave={() => { if (!isTauri()) setVideoDragOver(false); }}
            onDrop={handleVideoDrop}
            onBrowse={handleBrowseVideo}
            onClear={videoFilename ? clearVideo : undefined}
          />
          <DropZone
            label={t.translationPage.dropSrtHere}
            hint={t.translationPage.dropSrtHint}
            isOver={srtDragOver}
            isLoaded={!!srtFilename}
            loadedName={srtFilename}
            icon={<FileText className="h-6 w-6 text-muted-foreground" />}
            zoneRef={srtZoneRef}
            onDragOver={(e) => { e.preventDefault(); if (!isTauri()) setSrtDragOver(true); }}
            onDragLeave={() => { if (!isTauri()) setSrtDragOver(false); }}
            onDrop={handleSrtDrop}
            onBrowse={handleBrowseSrt}
            onClear={srtFilename ? clearSrt : undefined}
          />
        </div>
      </div>
    );
  }

  // ── Workspace view ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Status / export bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 bg-card/50 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-1 min-w-0">
          <Film className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-foreground font-medium truncate max-w-[180px]">{videoFilename}</span>
          <button
            type="button"
            onClick={clearVideo}
            className="ml-0.5 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
            title="关闭视频"
          >
            <X className="h-3 w-3" />
          </button>
          {srtFilename && (
            <>
              <span className="text-muted-foreground/40 mx-1">·</span>
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate max-w-[180px]">{srtFilename}</span>
              <button
                type="button"
                onClick={clearSrt}
                className="ml-0.5 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                title="关闭字幕"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => { downloadText(exportSrt(srtEntries, 'original'), `original_${srtFilename || 'output.srt'}`); isDirtyRef.current = false; }}>
          <Download className="h-3 w-3 mr-1" />{t.translationPage.exportOriginal}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => { downloadText(exportSrt(srtEntries, 'translation'), `translated_${srtFilename || 'output.srt'}`); isDirtyRef.current = false; }}>
          <Download className="h-3 w-3 mr-1" />{t.translationPage.exportTranslation}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => { downloadText(exportSrt(srtEntries, 'bilingual'), `bilingual_${srtFilename || 'output.srt'}`); isDirtyRef.current = false; }}>
          <Download className="h-3 w-3 mr-1" />{t.translationPage.exportBilingual}
        </Button>
        <div className="w-px h-4 bg-border/60 mx-1 shrink-0" />
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowGlossary(true)}>
          <BookOpen className="h-3 w-3 mr-1" />{t.translationPage.glossaryButton}
          {glossaryRows.length > 0 && (
            <span className="ml-1 text-[10px] bg-primary/20 text-primary rounded-full px-1.5 py-0.5 font-mono leading-none">
              {glossaryRows.length}
            </span>
          )}
        </Button>
      </div>

      {/* ── Glossary dialog ──────────────────────────────────────────────── */}
      {showGlossary && (
        <GlossaryDialog
          rows={glossaryRows}
          onRowsChange={setGlossaryRows}
          onClose={() => setShowGlossary(false)}
        />
      )}

      {/* ── Video area ──────────────────────────────────────────────────── */}
      <div className="relative bg-black flex-shrink-0" style={{ maxHeight: '40vh' }}>
        <video
          ref={videoRef}
          src={videoUrl!}
          className="w-full object-contain"
          style={{ maxHeight: '40vh' }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
        {/* Subtitle overlay */}
        {overlayLines.length > 0 && (
          <div
            className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none flex flex-col items-center gap-0.5"
            style={{ bottom: `${subtitleOffsetPct}%` }}
          >
            {overlayLines.map((line, i) => (
              <span key={i} className="bg-black/75 text-white text-sm px-2 py-0.5 rounded">
                {line}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Controls bar ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/60 bg-card/30 flex-shrink-0 flex-wrap">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => seek(-5)}>
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePlayPause}>
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => seek(5)}>
          <SkipForward className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs font-mono text-muted-foreground mx-1 shrink-0">
          {formatTimecode(currentMs)} / {formatTimecode(duration * 1000)}
        </span>

        {/* Time scrubber */}
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.05}
          value={currentTime}
          onChange={(e) => handleSeek(parseFloat(e.target.value))}
          className="flex-1 h-1 cursor-pointer accent-primary min-w-[60px]"
          style={{ minWidth: 60 }}
        />

        {/* Speed */}
        <Button variant="ghost" size="sm" className="h-7 text-xs font-mono px-2 shrink-0" onClick={cycleSpeed}>
          {SPEEDS[speedIdx]}×
        </Button>

        {/* Subtitle mode cycle */}
        <Button
          variant="ghost" size="sm" className="h-7 text-xs px-2"
          onClick={() => {
            const modes: SubtitleMode[] = ['both', 'original', 'translated', 'none'];
            setSubtitleMode((m) => modes[(modes.indexOf(m) + 1) % modes.length]);
          }}
        >
          {subtitleMode === 'both' && t.translationPage.subBoth}
          {subtitleMode === 'original' && t.translationPage.subOriginal}
          {subtitleMode === 'translated' && t.translationPage.subTranslated}
          {subtitleMode === 'none' && t.translationPage.subNone}
        </Button>

        {/* Subtitle position */}
        <div className="flex items-center gap-0.5 ml-1">
          <span className="text-xs text-muted-foreground hidden sm:inline mr-1">{t.translationPage.subtitleOffset}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" title={t.translationPage.subtitleUp}
            onClick={() => setSubtitleOffsetPct((p) => Math.min(90, p + 5))}>
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs font-mono text-muted-foreground w-7 text-center">{subtitleOffsetPct}%</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" title={t.translationPage.subtitleDown}
            onClick={() => setSubtitleOffsetPct((p) => Math.max(2, p - 5))}>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Waveform ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0">
        <WaveformDisplay
          peaks={peaks}
          duration={duration}
          currentTime={currentTime}
          srtEntries={srtEntries}
          ffmpegStatus={ffmpegStatus}
          waveformStatus={waveformStatus}
          waveformError={waveformError}
          onSeek={handleSeek}
          onEntryUpdate={handleEntryUpdate}
          onInsertEntry={handleInsertEntry}
          onDeleteEntry={handleDeleteEntry}
          onMergeWithPrev={handleMergeWithPrev}
          onMergeWithNext={handleMergeWithNext}
          onDownloadFfmpeg={handleDownloadFfmpeg}
        />
      </div>

      {/* ── Translation table ─────────────────────────────────────────────── */}
      <div ref={tableRef} className="flex-1 overflow-y-auto">
        {srtEntries.map((entry, idx) => {
          const isActive = idx === activeIdx;
          return (
            <div
              key={entry.index}
              ref={(el) => { rowRefs.current[idx] = el; }}
              className={`relative border-b border-border/40 transition-colors ${
                isActive ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/20'
              }`}
              onContextMenu={(e) => {
                e.preventDefault();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setTableMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, idx });
              }}
            >
              {/* Timecode header */}
              <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs text-muted-foreground select-none">
                <span className={`font-semibold ${isActive ? 'text-primary' : 'text-muted-foreground/50'}`}>
                  #{entry.index}
                </span>
                <span className="font-mono">{msToSrtTime(entry.startMs)}</span>
                <span className="opacity-40">→</span>
                <span className="font-mono">{msToSrtTime(entry.endMs)}</span>
                <span className="text-muted-foreground/50">({formatDuration(entry.endMs - entry.startMs)})</span>
                <div className="flex-1" />
                <button
                  className="p-0.5 rounded hover:bg-accent opacity-40 hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const parentRect = (e.currentTarget as HTMLElement)
                      .closest('.relative')?.getBoundingClientRect() ?? rect;
                    setTableMenu({
                      x: rect.right - parentRect.left - 164,
                      y: rect.bottom - parentRect.top + 2,
                      idx,
                    });
                  }}
                >
                  <MoreVertical className="h-3 w-3" />
                </button>
              </div>

              {/* Two-column edit */}
              <div className="flex">
                <textarea
                  ref={(el) => {
                    const key = `orig-${idx}`;
                    if (el) textareaRefs.current.set(key, el);
                    else textareaRefs.current.delete(key);
                    autoResize(el);
                  }}
                  rows={1}
                  value={entry.originalText}
                  onChange={(e) => { handleOriginalChange(idx, e.target.value); autoResize(e.currentTarget); }}
                  onFocus={() => {
                    const ms = currentTime * 1000;
                    if (ms < entry.startMs || ms >= entry.endMs) handleSeek(entry.startMs / 1000);
                  }}
                  className="flex-1 resize-none bg-transparent px-3 py-1.5 text-sm text-foreground/80 focus:outline-none focus:bg-muted/10 transition-colors border-r border-border/30 overflow-hidden"
                  onKeyDown={(e: KeyboardEvent) => e.stopPropagation()}
                />
                <textarea
                  ref={(el) => {
                    const key = `trans-${idx}`;
                    if (el) textareaRefs.current.set(key, el);
                    else textareaRefs.current.delete(key);
                    autoResize(el);
                  }}
                  rows={1}
                  value={entry.translatedText}
                  onChange={(e) => { handleTranslationChange(idx, e.target.value); autoResize(e.currentTarget); }}
                  onFocus={() => {
                    const ms = currentTime * 1000;
                    if (ms < entry.startMs || ms >= entry.endMs) handleSeek(entry.startMs / 1000);
                  }}
                  placeholder={t.translationPage.placeholder}
                  className="flex-1 resize-none bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:bg-muted/10 transition-colors overflow-hidden"
                  onKeyDown={(e: KeyboardEvent) => e.stopPropagation()}
                />
              </div>

              {/* Row context menu */}
              {tableMenu?.idx === idx && (
                <div
                  className="absolute z-50 min-w-[160px] bg-card border border-border rounded-md shadow-lg py-1 text-sm"
                  style={{ left: tableMenu.x, top: tableMenu.y }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors"
                    onClick={() => { handleMergeWithPrev(idx); setTableMenu(null); }}>
                    {t.translationPage.mergePrev}
                  </button>
                  <button className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors"
                    onClick={() => { handleMergeWithNext(idx); setTableMenu(null); }}>
                    {t.translationPage.mergeNext}
                  </button>
                  <div className="my-1 h-px bg-border" />
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-destructive/10 text-destructive transition-colors"
                    onClick={() => { handleDeleteEntry(idx); setTableMenu(null); }}>
                    {t.translationPage.deleteSubtitle}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Exit confirmation dialog ─────────────────────────────────────────────── */}
      {showExitDialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-[420px] max-w-[92vw] p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-muted-foreground" />
              <h2 className="font-semibold text-base">{t.translationPage.exitDialogTitle}</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{t.translationPage.exitDialogMessage}</p>
            <div className="flex flex-col gap-2 pt-1">
              <Button
                className="justify-center"
                onClick={() => {
                  downloadText(exportSrt(srtEntries, 'bilingual'), `bilingual_${srtFilename || 'output.srt'}`);
                  isDirtyRef.current = false;
                  setShowExitDialog(false);
                  pendingCloseRef.current?.();
                }}
              >
                <Download className="h-4 w-4 mr-2" />{t.translationPage.exitDialogExport}
              </Button>
              <Button
                variant="destructive"
                className="justify-center"
                onClick={() => {
                  isDirtyRef.current = false;
                  setShowExitDialog(false);
                  pendingCloseRef.current?.();
                }}
              >
                {t.translationPage.exitDialogDiscard}
              </Button>
              <Button
                variant="outline"
                className="justify-center"
                onClick={() => {
                  pendingCloseRef.current = null;
                  setShowExitDialog(false);
                }}
              >
                {t.translationPage.exitDialogCancel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
