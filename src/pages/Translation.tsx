import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type DragEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  Download,
  Film,
  FileText,
  X,
  BookOpen,
  Columns2,
  Rows3,
} from 'lucide-react';
import { WaveformDisplay, type SrtEntry } from '@/components/WaveformDisplay';
import { PlaybackControls } from '@/components/subtitle/PlaybackControls';
import { GlossaryDialog, countGlossaryEntries, downloadGlossary, type GlossaryEntry } from '@/components/subtitle/GlossaryDialog';
import { SubtitleEditTable, type SubtitleEditColumn } from '@/components/subtitle/SubtitleEditTable';
import { SubtitleImportView } from '@/components/subtitle/SubtitleImportView';
import { SubtitleOffsetControls } from '@/components/subtitle/SubtitleOffsetControls';
import { SubtitleVideoPreview } from '@/components/subtitle/SubtitleVideoPreview';
import { claimCloseGuard, releaseCloseGuard } from '@/components/subtitle/closeGuardCoordinator';
import { useSpacebarPlaybackShortcut } from '@/components/subtitle/useSpacebarPlaybackShortcut';
import {
  SPEEDS,
  deleteSubtitleEntry,
  downloadFile,
  exportSrt,
  insertBlankSubtitleEntry,
  insertSubtitleEntry,
  mergeSubtitleEntries,
  msToSrtTime,
  parseSrt,
  splitSubtitleEntry,
  splitSubtitleText,
  type FFmpegStatus,
  type SubtitleMode,
  type WaveformStatus,
} from '@/components/subtitle/subtitleWorkspace';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface ExitDirtyState {
  subtitles: boolean;
  glossary: boolean;
}

interface TranslationEntry extends SrtEntry {
  translationNote: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type WorkspaceLayout = 'stacked' | 'side';

interface PendingTranslationImport {
  srtContent: string;
  srtFilename: string;
  srtPath: string | null;
  videoName: string;
  videoPath: string | null;
  videoObjectUrl: string | null;
}

const PENDING_TRANSLATION_IMPORT_KEY = 'qafone-pending-translation-import';
const LEGACY_PENDING_SRT_KEY = 'qafone-pending-srt';
const TRANSLATION_BUSY_KEY = 'qafone-translation-busy';
const TRANSLATION_IMPORT_EVENT = 'qafone-translation-import';

function toTranslationEntries(entries: SrtEntry[]): TranslationEntry[] {
  return entries.map((entry) => ({
    ...entry,
    translationNote: (entry as Partial<TranslationEntry>).translationNote ?? '',
  }));
}

function getFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

function takePendingTranslationImport(): PendingTranslationImport | null {
  const raw = sessionStorage.getItem(PENDING_TRANSLATION_IMPORT_KEY);
  if (raw) {
    sessionStorage.removeItem(PENDING_TRANSLATION_IMPORT_KEY);
    try {
      const parsed = JSON.parse(raw) as Partial<PendingTranslationImport>;
      if (typeof parsed.srtContent === 'string' && parsed.srtContent.trim()) {
        return {
          srtContent: parsed.srtContent,
          srtFilename: typeof parsed.srtFilename === 'string' && parsed.srtFilename ? parsed.srtFilename : 'subtitles.srt',
          srtPath: typeof parsed.srtPath === 'string' ? parsed.srtPath : null,
          videoName: typeof parsed.videoName === 'string' ? parsed.videoName : '',
          videoPath: typeof parsed.videoPath === 'string' ? parsed.videoPath : null,
          videoObjectUrl: typeof parsed.videoObjectUrl === 'string' ? parsed.videoObjectUrl : null,
        };
      }
    } catch (error) {
      console.error('Failed to parse pending translation import:', error);
    }
  }

  const legacySrt = sessionStorage.getItem(LEGACY_PENDING_SRT_KEY);
  if (!legacySrt) return null;
  sessionStorage.removeItem(LEGACY_PENDING_SRT_KEY);
  return {
    srtContent: legacySrt,
    srtFilename: 'subtitles.srt',
    srtPath: null,
    videoName: '',
    videoPath: null,
    videoObjectUrl: null,
  };
}

function hasTranslationNote(entry: TranslationEntry): boolean {
  return entry.translationNote.trim() !== '';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(s: string): string {
  return escapeHtml(s || '').replace(/\n/g, '<br />');
}

function buildTranslationNotesHtml(
  entries: TranslationEntry[],
  title: string,
  emptyLabel: string,
  labels: { time: string; original: string; translation: string; translationNote: string },
): string {
  const items = entries.filter(hasTranslationNote);
  const rows = items.map((entry) => `
    <article class="entry">
      <div class="meta">#${entry.index} · ${msToSrtTime(entry.startMs)} - ${msToSrtTime(entry.endMs)}</div>
      <section><h2>${escapeHtml(labels.original)}</h2><p>${textToHtml(entry.originalText)}</p></section>
      <section><h2>${escapeHtml(labels.translation)}</h2><p>${textToHtml(entry.translatedText)}</p></section>
      ${entry.translationNote.trim() ? `<section class="note"><h2>${escapeHtml(labels.translationNote)}</h2><p>${textToHtml(entry.translationNote)}</p></section>` : ''}
    </article>
  `).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f6f7f9; color: #1f2933; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 920px; margin: 0 auto; padding: 40px 24px 64px; }
    h1 { margin: 0 0 20px; font-size: 28px; }
    .entry { background: #fff; border: 1px solid #e4e7ec; border-radius: 8px; padding: 18px; margin: 14px 0; }
    .meta { margin-bottom: 12px; color: #667085; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
    h2 { margin: 0 0 6px; font-size: 12px; color: #475467; }
    p { margin: 0 0 12px; line-height: 1.7; }
    .note { border-left: 4px solid #f59e0b; padding: 12px; background: #fffbeb; border-radius: 6px; }
    .empty { background: #fff; border: 1px dashed #c7cdd7; border-radius: 8px; padding: 24px; color: #667085; }
  </style>
</head>
<body><main><h1>${escapeHtml(title)}</h1>${items.length > 0 ? rows : `<div class="empty">${escapeHtml(emptyLabel)}</div>`}</main></body>
</html>`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TranslationPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location.pathname);
  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);

  // Video / SRT state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null); // Tauri 文件系统路径
  const [srtEntries, setSrtEntries] = useState<TranslationEntry[]>([]);
  const [srtFilename, setSrtFilename] = useState('');
  const [srtFilePath, setSrtFilePath] = useState<string | null>(null);
  const [videoFilename, setVideoFilename] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayout>(() => {
    try {
      return localStorage.getItem('qafone-subtitle-workspace-layout') === 'side' ? 'side' : 'stacked';
    } catch {
      return 'stacked';
    }
  });

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
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Table context menu
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number; idx: number } | null>(null);
  const tableMenuRef = useRef<HTMLDivElement>(null);

  // Glossary
  const [showGlossary, setShowGlossary] = useState(false);

  // Exit guard
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [exitDirtyState, setExitDirtyState] = useState<ExitDirtyState>({ subtitles: false, glossary: false });
  const subtitleDirtyRef = useRef(false);
  const glossaryDirtyRef = useRef(false);
  const lastSavedContentRef = useRef('');
  const saveTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
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

  const handleGlossaryRowsChange = useCallback((rows: GlossaryEntry[]) => {
    glossaryDirtyRef.current = true;
    setGlossaryRows(rows);
  }, []);

  // Tauri window close guard — show confirmation when there are unsaved subtitle entries
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested((event) => {
        const dirtyState = {
          subtitles: subtitleDirtyRef.current,
          glossary: glossaryDirtyRef.current,
        };
        if (isForceClosingRef.current || (!dirtyState.subtitles && !dirtyState.glossary)) return;

        event.preventDefault();
        if (!claimCloseGuard('translation')) return;
        navigate('/translation');
        setExitDirtyState(dirtyState);
        pendingCloseRef.current = async () => {
          isForceClosingRef.current = true;
          await appWindow.destroy();
        };
        setShowExitDialog(true);
      });
    })();
    return () => { unlisten?.(); };
  }, [navigate]);

  const loadSrtContent = useCallback((content: string, filename: string, path: string | null, dirty = false) => {
    const parsed = toTranslationEntries(parseSrt(content));
    setSrtEntries(parsed);
    setSrtFilename(filename);
    setSrtFilePath(path);
    setSaveStatus(path ? 'saved' : 'idle');
    lastSavedContentRef.current = exportSrt(parsed, 'bilingual');
    subtitleDirtyRef.current = dirty || !path;
  }, []);

  // Persist the in-memory translation workspace, including translation notes.
  useEffect(() => {
    if (srtEntries.length === 0) return;
    try { localStorage.setItem('qafone-translation-entries', JSON.stringify(srtEntries)); }
    catch { /* quota */ }
  }, [srtEntries]);

  // Auto-save imported desktop subtitle files back to disk.
  useEffect(() => {
    if (!srtFilePath || srtEntries.length === 0) return;
    const content = exportSrt(srtEntries, 'bilingual');
    if (content === lastSavedContentRef.current) {
      subtitleDirtyRef.current = false;
      setSaveStatus('saved');
      return;
    }

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    subtitleDirtyRef.current = true;
    setSaveStatus('saving');
    saveTimerRef.current = window.setTimeout(() => {
      invoke('save_text_file', { path: srtFilePath, content })
        .then(() => {
          lastSavedContentRef.current = content;
          subtitleDirtyRef.current = false;
          setSaveStatus('saved');
        })
        .catch((error) => {
          console.error('Failed to autosave translation file:', error);
          subtitleDirtyRef.current = true;
          setSaveStatus('error');
        });
    }, 350);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [srtEntries, srtFilePath]);

  const importPendingTranslationTask = useCallback(async () => {
    const pending = takePendingTranslationImport();
    if (!pending) return;

    if (pending.videoPath && isTauri()) {
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const url = convertFileSrc(pending.videoPath);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoFilePath(pending.videoPath);
      setVideoFile(null);
      setVideoUrl(url);
      setVideoFilename(pending.videoName || getFileName(pending.videoPath));
      setPeaks(null);
      setWaveformStatus('idle');
      setCurrentTime(0);
      setIsPlaying(false);
    } else if (pending.videoObjectUrl) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoFilePath(null);
      setVideoFile(null);
      setVideoUrl(pending.videoObjectUrl);
      setVideoFilename(pending.videoName || 'video');
      setPeaks(null);
      setWaveformStatus('idle');
      setCurrentTime(0);
      setIsPlaying(false);
    }

    const parsed = toTranslationEntries(parseSrt(pending.srtContent));
    if (parsed.length > 0) {
      const content = exportSrt(parsed, 'bilingual');
      loadSrtContent(content, pending.srtFilename || 'subtitles.srt', pending.srtPath, true);
      subtitleDirtyRef.current = true;
    }
  }, [loadSrtContent, videoUrl]);

  // Load SRT/video from subtitle extraction page. The page stays mounted while
  // hidden, so navigation alone will not re-run this effect; listen for an event.
  useEffect(() => {
    importPendingTranslationTask();
    window.addEventListener(TRANSLATION_IMPORT_EVENT, importPendingTranslationTask);
    return () => window.removeEventListener(TRANSLATION_IMPORT_EVENT, importPendingTranslationTask);
  }, [importPendingTranslationTask]);

  // Auto-scroll to active
  useEffect(() => {
    if (activeIdx < 0) return;
    rowRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIdx]);

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

  const handlePlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  }, []);

  useSpacebarPlaybackShortcut(handlePlayPause, location.pathname === '/translation');

  // Table menu dismiss
  useEffect(() => {
    if (!tableMenu) return;
    const dismiss = (e: globalThis.MouseEvent) => {
      if (tableMenuRef.current && tableMenuRef.current.contains(e.target as Node)) return;
      setTableMenu(null);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
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
                const name = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
                loadSrtContent(text, name, filePath);
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
      loadSrtContent(text, file.name, null, false);
    });
  }, [loadSrtContent]);

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
          const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
          loadSrtContent(text, name, path);
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
      loadSrtContent(text, file.name, null, false);
    });
  }, [loadSrtContent]);

  const handleOriginalChange = (idx: number, value: string) => {
    subtitleDirtyRef.current = true;
    setSrtEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, originalText: value } : e)));
  };

  const handleTranslationChange = (idx: number, value: string) => {
    subtitleDirtyRef.current = true;
    setSrtEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, translatedText: value } : e)));
  };

  const handleTranslationNoteChange = (idx: number, value: string) => {
    subtitleDirtyRef.current = true;
    setSrtEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, translationNote: value } : e)));
  };

  const handleEntryUpdate = (idx: number, changes: Partial<Pick<SrtEntry, 'startMs' | 'endMs'>>) => {
    subtitleDirtyRef.current = true;
    setSrtEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...changes } : e)));
  };

  const createBlankTranslationEntry = (startMs: number, endMs: number): TranslationEntry => ({
    index: 0,
    startMs,
    endMs,
    originalText: '',
    translatedText: '',
    translationNote: '',
  });

  const handleInsertEntry = (startMs: number) => { subtitleDirtyRef.current = true; setSrtEntries((p) => insertSubtitleEntry(p, startMs, createBlankTranslationEntry)); };
  const handleDeleteEntry = (idx: number) => { subtitleDirtyRef.current = true; setSrtEntries((p) => deleteSubtitleEntry(p, idx)); };
  const handleMergeWithPrev = (idx: number) => { subtitleDirtyRef.current = true; setSrtEntries((p) => mergeSubtitleEntries(p, idx, 'prev', (left, right) => ({
    translationNote: [left.translationNote, right.translationNote].filter((note) => note.trim()).join('\n'),
  }))); };
  const handleMergeWithNext = (idx: number) => { subtitleDirtyRef.current = true; setSrtEntries((p) => mergeSubtitleEntries(p, idx, 'next', (left, right) => ({
    translationNote: [left.translationNote, right.translationNote].filter((note) => note.trim()).join('\n'),
  }))); };
  const handleInsertBlankBefore = (idx: number) => {
    const next = insertBlankSubtitleEntry(srtEntries, idx, 'before', duration * 1000, createBlankTranslationEntry);
    if (!next) {
      window.alert(t.translationPage.insertBlankFailed);
      return;
    }
    subtitleDirtyRef.current = true;
    setSrtEntries(next);
  };
  const handleInsertBlankAfter = (idx: number) => {
    const next = insertBlankSubtitleEntry(srtEntries, idx, 'after', duration * 1000, createBlankTranslationEntry);
    if (!next) {
      window.alert(t.translationPage.insertBlankFailed);
      return;
    }
    subtitleDirtyRef.current = true;
    setSrtEntries(next);
  };
  const handleSplitEntry = (idx: number) => {
    subtitleDirtyRef.current = true;
    setSrtEntries(splitSubtitleEntry(srtEntries, idx, (entry) => {
      const noteSplit = splitSubtitleText(entry.translationNote);
      return [
        { translationNote: noteSplit.first },
        { translationNote: noteSplit.didSplit ? noteSplit.second : '' },
      ];
    }));
  };

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
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSrtEntries([]);
    setSrtFilename('');
    setSrtFilePath(null);
    setSaveStatus('idle');
    lastSavedContentRef.current = '';
    subtitleDirtyRef.current = false;
  }, []);

  const hasVideo = !!videoUrl;
  const hasSrt = srtEntries.length > 0;
  const exportableTranslationNoteCount = srtEntries.filter(hasTranslationNote).length;
  const glossaryEntryCount = countGlossaryEntries(glossaryRows);

  useEffect(() => {
    sessionStorage.setItem(TRANSLATION_BUSY_KEY, hasVideo || hasSrt ? '1' : '0');
  }, [hasVideo, hasSrt]);

  const subtitleModeLabel =
    subtitleMode === 'both'
      ? t.translationPage.subBoth
      : subtitleMode === 'original'
      ? t.translationPage.subOriginal
      : subtitleMode === 'translated'
      ? t.translationPage.subTranslated
      : t.translationPage.subNone;
  const cycleSubtitleMode = () => {
    const modes: SubtitleMode[] = ['both', 'original', 'translated', 'none'];
    setSubtitleMode((mode) => modes[(modes.indexOf(mode) + 1) % modes.length]);
  };
  const isSideLayout = workspaceLayout === 'side';
  const toggleWorkspaceLayout = () => {
    setWorkspaceLayout((layout) => {
      const next = layout === 'side' ? 'stacked' : 'side';
      try { localStorage.setItem('qafone-subtitle-workspace-layout', next); }
      catch { /* storage unavailable */ }
      return next;
    });
  };
  const exitDialogMessage = exitDirtyState.subtitles && exitDirtyState.glossary
    ? t.translationPage.exitDialogBothMessage
    : exitDirtyState.glossary
    ? t.translationPage.exitDialogGlossaryMessage
    : t.translationPage.exitDialogMessage;
  const exitDialogExportLabel = exitDirtyState.subtitles && exitDirtyState.glossary
    ? t.translationPage.exitDialogExportBoth
    : exitDirtyState.glossary
    ? t.translationPage.exitDialogExportGlossary
    : t.translationPage.exitDialogExport;
  const handleExportAndClose = () => {
    if (exitDirtyState.subtitles) {
      downloadFile(exportSrt(srtEntries, 'bilingual'), `bilingual_${srtFilename || 'output.srt'}`);
      subtitleDirtyRef.current = false;
    }
    if (exitDirtyState.glossary) {
      downloadGlossary(glossaryRows, {
        original: t.translationPage.glossaryColOriginal,
        translation: t.translationPage.glossaryColTranslation,
        notes: t.translationPage.glossaryColNotes,
      });
      glossaryDirtyRef.current = false;
    }
    setShowExitDialog(false);
    pendingCloseRef.current?.();
  };
  const exportTranslationNotes = () => {
    const html = buildTranslationNotesHtml(srtEntries, t.translationPage.translationNotesTitle, t.translationPage.translationNotesEmpty, {
      time: t.translationPage.timecode,
      original: t.translationPage.original,
      translation: t.translationPage.translation,
      translationNote: t.translationPage.translationNote,
    });
    downloadFile(html, 'translation-notes.html', 'text/html;charset=utf-8');
  };
  const translationColumns: SubtitleEditColumn<TranslationEntry>[] = [
    {
      id: 'original',
      label: t.translationPage.original,
      value: (entry) => entry.originalText,
      onChange: handleOriginalChange,
    },
    {
      id: 'translation',
      label: t.translationPage.translation,
      value: (entry) => entry.translatedText,
      onChange: handleTranslationChange,
      placeholder: t.translationPage.placeholder,
    },
    {
      id: 'translation-note',
      label: t.translationPage.translationNote,
      value: (entry) => entry.translationNote,
      onChange: handleTranslationNoteChange,
      tone: 'note',
    },
  ];
  const exitDialog = showExitDialog && (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[420px] max-w-[92vw] p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold text-base">{t.translationPage.exitDialogTitle}</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{exitDialogMessage}</p>
        <div className="flex flex-col gap-2 pt-1">
          <Button className="justify-center" onClick={handleExportAndClose}>
            <Download className="h-4 w-4 mr-2" />{exitDialogExportLabel}
          </Button>
          <Button
            variant="destructive"
            className="justify-center"
            onClick={() => {
              subtitleDirtyRef.current = false;
              glossaryDirtyRef.current = false;
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
              releaseCloseGuard('translation');
              setShowExitDialog(false);
            }}
          >
            {t.translationPage.exitDialogCancel}
          </Button>
        </div>
      </div>
    </div>
  );

  // ── Drop zone view ────────────────────────────────────────────────────────
  if (!hasVideo || !hasSrt) {
    return (
      <SubtitleImportView
        title={t.translationPage.title}
        subtitle={t.translationPage.subtitle}
        videoLabel={t.translationPage.dropVideoHere}
        videoHint={t.translationPage.dropVideoHint}
        srtLabel={t.translationPage.dropSrtHere}
        srtHint={t.translationPage.dropSrtHint}
        browseLabel={t.translationPage.browseFile}
        videoInputRef={videoInputRef}
        srtInputRef={srtInputRef}
        videoZoneRef={videoZoneRef}
        srtZoneRef={srtZoneRef}
        videoDragOver={videoDragOver}
        srtDragOver={srtDragOver}
        videoFilename={videoFilename}
        srtFilename={srtFilename}
        onVideoInputChange={handleVideoFileChange}
        onSrtInputChange={handleSrtFileChange}
        onVideoDragOver={(e) => { e.preventDefault(); if (!isTauri()) setVideoDragOver(true); }}
        onSrtDragOver={(e) => { e.preventDefault(); if (!isTauri()) setSrtDragOver(true); }}
        onVideoDragLeave={() => { if (!isTauri()) setVideoDragOver(false); }}
        onSrtDragLeave={() => { if (!isTauri()) setSrtDragOver(false); }}
        onVideoDrop={handleVideoDrop}
        onSrtDrop={handleSrtDrop}
        onBrowseVideo={handleBrowseVideo}
        onBrowseSrt={handleBrowseSrt}
        onClearVideo={clearVideo}
        onClearSrt={clearSrt}
      >
        {exitDialog}
      </SubtitleImportView>
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
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {srtFilePath
                  ? saveStatus === 'saving'
                    ? t.translationPage.autosaveSaving
                    : saveStatus === 'error'
                    ? t.translationPage.autosaveError
                    : t.translationPage.autosaveSaved
                  : t.translationPage.autosaveBrowser}
              </span>
            </>
          )}
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={toggleWorkspaceLayout}>
          {isSideLayout ? <Rows3 className="h-3 w-3 mr-1" /> : <Columns2 className="h-3 w-3 mr-1" />}
          {isSideLayout ? t.translationPage.layoutStacked : t.translationPage.layoutSideBySide}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => { downloadFile(exportSrt(srtEntries, 'original'), `original_${srtFilename || 'output.srt'}`); subtitleDirtyRef.current = false; }}>
          <Download className="h-3 w-3 mr-1" />{t.translationPage.exportOriginal}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => { downloadFile(exportSrt(srtEntries, 'translation'), `translated_${srtFilename || 'output.srt'}`); subtitleDirtyRef.current = false; }}>
          <Download className="h-3 w-3 mr-1" />{t.translationPage.exportTranslation}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => { downloadFile(exportSrt(srtEntries, 'bilingual'), `bilingual_${srtFilename || 'output.srt'}`); subtitleDirtyRef.current = false; }}>
          <Download className="h-3 w-3 mr-1" />{t.translationPage.exportBilingual}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportTranslationNotes} disabled={exportableTranslationNoteCount === 0}>
          <Download className="h-3 w-3 mr-1" />{t.translationPage.exportTranslationNotes}
          {exportableTranslationNoteCount > 0 && (
            <span className="ml-1 text-[10px] bg-primary/20 text-primary rounded-full px-1.5 py-0.5 font-mono leading-none">
              {exportableTranslationNoteCount}
            </span>
          )}
        </Button>
        <div className="w-px h-4 bg-border/60 mx-1 shrink-0" />
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowGlossary(true)}>
          <BookOpen className="h-3 w-3 mr-1" />{t.translationPage.glossaryButton}
          {glossaryEntryCount > 0 && (
            <span className="ml-1 text-[10px] bg-primary/20 text-primary rounded-full px-1.5 py-0.5 font-mono leading-none">
              {glossaryEntryCount}
            </span>
          )}
        </Button>
      </div>

      {/* ── Glossary dialog ──────────────────────────────────────────────── */}
      {showGlossary && (
        <GlossaryDialog
          rows={glossaryRows}
          onRowsChange={handleGlossaryRowsChange}
          onExported={() => { glossaryDirtyRef.current = false; }}
          onClose={() => setShowGlossary(false)}
        />
      )}

      <div className={isSideLayout ? 'flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)] lg:overflow-hidden' : 'flex min-h-0 flex-1 flex-col'}>
        <div className={isSideLayout ? 'flex-shrink-0 lg:flex lg:min-h-0 lg:h-full lg:flex-col lg:overflow-hidden lg:border-r lg:border-border/60' : 'flex-shrink-0'}>
          <SubtitleVideoPreview
            videoRef={videoRef}
            videoUrl={videoUrl}
            overlayLines={overlayLines}
            overlayBottomPct={subtitleOffsetPct}
            fill={isSideLayout}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />

          <PlaybackControls
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            speedLabel={`${SPEEDS[speedIdx]}×`}
            subtitleMode={subtitleMode}
            subtitleModeLabel={subtitleModeLabel}
            onSeekBy={seek}
            onTogglePlay={handlePlayPause}
            onSeek={handleSeek}
            onCycleSpeed={cycleSpeed}
            onCycleSubtitleMode={cycleSubtitleMode}
          >
            <SubtitleOffsetControls
              label={t.translationPage.subtitleOffset}
              upLabel={t.translationPage.subtitleUp}
              downLabel={t.translationPage.subtitleDown}
              value={subtitleOffsetPct}
              onChange={setSubtitleOffsetPct}
            />
          </PlaybackControls>

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
            onInsertBlankBefore={handleInsertBlankBefore}
            onInsertBlankAfter={handleInsertBlankAfter}
            onSplitEntry={handleSplitEntry}
            onDownloadFfmpeg={handleDownloadFfmpeg}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <SubtitleEditTable
            entries={srtEntries}
            activeIdx={activeIdx}
            columns={translationColumns}
            gridTemplateColumns="minmax(220px,1fr) minmax(220px,1fr) minmax(220px,0.9fr)"
            tableMenu={tableMenu}
            tableMenuRef={tableMenuRef}
            rowRefs={rowRefs}
            onSetTableMenu={setTableMenu}
            onSeek={handleSeek}
            onMergeWithPrev={handleMergeWithPrev}
            onMergeWithNext={handleMergeWithNext}
            onInsertBefore={handleInsertBlankBefore}
            onInsertAfter={handleInsertBlankAfter}
            onSplit={handleSplitEntry}
            onDelete={handleDeleteEntry}
          />
        </div>
      </div>

      {/* ── Exit confirmation dialog ─────────────────────────────────────────────── */}
      {exitDialog}
    </div>
  );
}
