import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ChangeEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import {
  BookOpen,
  CheckSquare,
  Columns2,
  Download,
  FileText,
  FilePlus2,
  Film,
  Rows3,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { WaveformDisplay, type SrtEntry } from '@/components/WaveformDisplay';
import { DropZone } from '@/components/subtitle/DropZone';
import { GlossaryDialog, countGlossaryEntries, downloadGlossary, type GlossaryEntry } from '@/components/subtitle/GlossaryDialog';
import { PlaybackControls } from '@/components/subtitle/PlaybackControls';
import { SubtitleEditTable, type SubtitleEditColumn } from '@/components/subtitle/SubtitleEditTable';
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
  joinSubtitleText,
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

interface ProofreadEntry extends SrtEntry {
  previousTranslatedText: string;
  proofreadNote: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type WorkspaceLayout = 'stacked' | 'side';

interface ProofreadingExitDirtyState {
  proofread: boolean;
  glossary: boolean;
}

function parseProofreadSrt(content: string, baseline: SrtEntry[] = []): ProofreadEntry[] {
  return parseSrt(content).map((entry) => ({
    ...entry,
    previousTranslatedText:
      baseline.find((base) => base.index === entry.index)?.translatedText ??
      baseline.find((base) => base.startMs === entry.startMs && base.endMs === entry.endMs)?.translatedText ??
      entry.translatedText,
    proofreadNote: '',
  }));
}

function exportFinalSrt(entries: ProofreadEntry[]): string {
  return entries
    .map((e, i) => {
      const text = `${e.originalText}\n${e.translatedText || e.originalText}`;
      return `${i + 1}\n${msToSrtTime(e.startMs)} --> ${msToSrtTime(e.endMs)}\n${text}`;
    })
    .join('\n\n');
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

function getFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

function buildProofreadCopyPath(sourcePath: string): string {
  const slash = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'));
  const dir = slash >= 0 ? sourcePath.slice(0, slash + 1) : '';
  const filename = slash >= 0 ? sourcePath.slice(slash + 1) : sourcePath;
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '.srt';
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  return `${dir}${base}_proofread_${stamp}${ext}`;
}

function looksLikeProofreadFile(path: string): boolean {
  return /(^|[_\-\s])proofread([_\-\s.]|$)|校对/i.test(getFileName(path));
}

function changedOrNoted(entry: ProofreadEntry): boolean {
  return (
    entry.previousTranslatedText.trim() !== entry.translatedText.trim() ||
    entry.proofreadNote.trim() !== ''
  );
}

function buildProofreadNotesHtml(
  entries: ProofreadEntry[],
  title: string,
  emptyLabel: string,
  labels: {
    time: string;
    original: string;
    previousTranslation: string;
    finalTranslation: string;
    proofreadNote: string;
  },
): string {
  const items = entries.filter(changedOrNoted);
  const generatedAt = new Date().toLocaleString();
  const rows = items
    .map((entry) => {
      const note = entry.proofreadNote.trim();
      return `
        <article class="entry">
          <div class="meta">
            <span>#${entry.index}</span>
            <span>${escapeHtml(labels.time)}: ${msToSrtTime(entry.startMs)} - ${msToSrtTime(entry.endMs)}</span>
          </div>
          <section>
            <h2>${escapeHtml(labels.original)}</h2>
            <p>${textToHtml(entry.originalText)}</p>
          </section>
          <div class="translation-grid">
            <section>
              <h2>${escapeHtml(labels.previousTranslation)}</h2>
              <p>${textToHtml(entry.previousTranslatedText)}</p>
            </section>
            <section>
              <h2>${escapeHtml(labels.finalTranslation)}</h2>
              <p>${textToHtml(entry.translatedText)}</p>
            </section>
          </div>
          ${note ? `<section class="note"><h2>${escapeHtml(labels.proofreadNote)}</h2><p>${textToHtml(note)}</p></section>` : ''}
        </article>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f4f1ec; color: #1f2933; }
    main { max-width: 980px; margin: 0 auto; padding: 48px 24px 72px; }
    header { margin-bottom: 28px; border-bottom: 2px solid #1f2933; padding-bottom: 18px; }
    h1 { margin: 0 0 8px; font-size: 32px; letter-spacing: 0; }
    .summary { color: #667085; font-size: 14px; }
    .entry { background: #fff; border: 1px solid #ded7cc; border-radius: 8px; padding: 22px; margin: 18px 0; box-shadow: 0 8px 24px rgba(31,41,51,0.07); }
    .meta { display: flex; flex-wrap: wrap; gap: 10px; color: #667085; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-bottom: 14px; }
    h2 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; color: #475467; letter-spacing: .08em; }
    p { margin: 0; line-height: 1.72; white-space: normal; }
    section { margin-top: 14px; }
    .translation-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
    .translation-grid section { margin: 0; padding: 14px; border-radius: 6px; background: #f8fafc; border: 1px solid #e4e7ec; }
    .translation-grid section + section { background: #f0fdf4; border-color: #bbf7d0; }
    .note { padding: 14px; border-left: 4px solid #f59e0b; background: #fffbeb; border-radius: 6px; }
    .empty { background: #fff; border: 1px dashed #c7c0b8; border-radius: 8px; padding: 28px; color: #667085; }
    @media (max-width: 720px) { .translation-grid { grid-template-columns: 1fr; } main { padding: 28px 16px 48px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div class="summary">${items.length} items · ${escapeHtml(generatedAt)}</div>
    </header>
    ${items.length > 0 ? rows : `<div class="empty">${escapeHtml(emptyLabel)}</div>`}
  </main>
</body>
</html>`;
}

export default function ProofreadingPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const p = t.proofreadingPage;
  const locationRef = useRef(location.pathname);
  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);
  const [videoFilename, setVideoFilename] = useState('');
  const [translationEntries, setTranslationEntries] = useState<SrtEntry[]>([]);
  const [translationContent, setTranslationContent] = useState('');
  const [translationFilePath, setTranslationFilePath] = useState<string | null>(null);
  const [translationFilename, setTranslationFilename] = useState('');
  const [entries, setEntries] = useState<ProofreadEntry[]>([]);
  const [proofreadContent, setProofreadContent] = useState('');
  const [proofreadFilePath, setProofreadFilePath] = useState<string | null>(null);
  const [proofreadFilename, setProofreadFilename] = useState('');
  const [proofreadReady, setProofreadReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayout>(() => {
    try {
      return localStorage.getItem('qafone-subtitle-workspace-layout') === 'side' ? 'side' : 'stacked';
    } catch {
      return 'stacked';
    }
  });
  const [showGlossary, setShowGlossary] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [exitDirtyState, setExitDirtyState] = useState<ProofreadingExitDirtyState>({ proofread: false, glossary: false });
  const [glossaryRows, setGlossaryRows] = useState<GlossaryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('qafone-glossary');
      return saved ? (JSON.parse(saved) as GlossaryEntry[]) : [];
    } catch {
      return [];
    }
  });

  const [videoDragOver, setVideoDragOver] = useState(false);
  const [srtDragOver, setSrtDragOver] = useState(false);
  const [proofreadDragOver, setProofreadDragOver] = useState(false);
  const activeDragZoneRef = useRef<'video' | 'translation' | 'proofread' | null>(null);
  const videoZoneRef = useRef<HTMLDivElement>(null);
  const srtZoneRef = useRef<HTMLDivElement>(null);
  const proofreadZoneRef = useRef<HTMLDivElement>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(2);
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>('both');
  const [subtitleOffsetPct, setSubtitleOffsetPct] = useState(8);

  const [ffmpegStatus, setFfmpegStatus] = useState<FFmpegStatus>('checking');
  const [waveformStatus, setWaveformStatus] = useState<WaveformStatus>('idle');
  const [waveformError, setWaveformError] = useState<string | undefined>();
  const [peaks, setPeaks] = useState<Float32Array | null>(null);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const proofreadInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number; idx: number } | null>(null);
  const tableMenuRef = useRef<HTMLDivElement>(null);
  const lastSavedContentRef = useRef('');
  const saveTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const proofreadDirtyRef = useRef(false);
  const glossaryDirtyRef = useRef(false);
  const pendingCloseRef = useRef<(() => Promise<void>) | null>(null);
  const isForceClosingRef = useRef(false);

  const currentMs = currentTime * 1000;
  const activeIdx = entries.findIndex((e) => currentMs >= e.startMs && currentMs < e.endMs);
  const activeEntry = activeIdx >= 0 ? entries[activeIdx] : null;
  const exportableCount = useMemo(() => entries.filter(changedOrNoted).length, [entries]);

  useEffect(() => {
    invoke<boolean>('check_ffmpeg_status')
      .then((ok) => setFfmpegStatus(ok ? 'available' : 'not-found'))
      .catch(() => setFfmpegStatus('not-found'));
  }, []);

  useEffect(() => {
    if (ffmpegStatus !== 'available' || duration <= 0) return;
    const filePath = videoFilePath ?? (videoFile as File & { path?: string } | null)?.path;
    if (!filePath) return;
    setWaveformStatus('loading');
    setWaveformError(undefined);
    invoke<number[]>('extract_waveform', { videoPath: filePath, samplesPerSecond: 100 })
      .then((data) => { setPeaks(new Float32Array(data)); setWaveformStatus('ready'); })
      .catch((err) => { setWaveformStatus('error'); setWaveformError(String(err)); });
  }, [videoFile, videoFilePath, ffmpegStatus, duration]);

  useEffect(() => {
    if (activeIdx < 0) return;
    rowRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIdx]);

  useEffect(() => {
    try { localStorage.setItem('qafone-glossary', JSON.stringify(glossaryRows)); }
    catch { /* quota */ }
  }, [glossaryRows]);

  const handleGlossaryRowsChange = useCallback((rows: GlossaryEntry[]) => {
    glossaryDirtyRef.current = true;
    setGlossaryRows(rows);
  }, []);

  useEffect(() => {
    if (!tableMenu) return;
    const dismiss = (e: globalThis.MouseEvent) => {
      if (tableMenuRef.current && tableMenuRef.current.contains(e.target as Node)) return;
      setTableMenu(null);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [tableMenu]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested((event) => {
        const dirtyState = {
          proofread: proofreadDirtyRef.current,
          glossary: glossaryDirtyRef.current,
        };
        if (isForceClosingRef.current || (!dirtyState.proofread && !dirtyState.glossary)) return;

        event.preventDefault();
        if (!claimCloseGuard('proofreading')) return;
        navigate('/proofreading');
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

  const loadTranslationContent = useCallback((content: string, filename: string, path: string | null) => {
    const parsedTranslation = parseSrt(content);
    setTranslationEntries(parsedTranslation);
    setTranslationContent(content);
    setTranslationFilePath(path);
    setTranslationFilename(filename);
    if (proofreadContent) {
      setEntries(parseProofreadSrt(proofreadContent, parsedTranslation));
    }
  }, [proofreadContent]);

  const loadProofreadContent = useCallback((content: string, filename: string, path: string | null) => {
    const parsed = parseProofreadSrt(content, translationEntries);
    setEntries(parsed);
    setProofreadContent(content);
    setProofreadFilePath(path);
    setProofreadFilename(filename);
    setProofreadReady(true);
    setSaveStatus(path ? 'saved' : 'idle');
    lastSavedContentRef.current = exportFinalSrt(parsed);
    proofreadDirtyRef.current = !path;
  }, [translationEntries]);

  useEffect(() => {
    if (!proofreadReady || !proofreadFilePath || entries.length === 0) return;
    const content = exportFinalSrt(entries);
    if (content === lastSavedContentRef.current) {
      proofreadDirtyRef.current = false;
      return;
    }

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    proofreadDirtyRef.current = true;
    setSaveStatus('saving');
    saveTimerRef.current = window.setTimeout(() => {
      invoke('save_text_file', { path: proofreadFilePath, content })
        .then(() => {
          lastSavedContentRef.current = content;
          proofreadDirtyRef.current = false;
          setSaveStatus('saved');
        })
        .catch((error) => {
          console.error('Failed to autosave proofreading file:', error);
          proofreadDirtyRef.current = true;
          setSaveStatus('error');
        });
    }, 350);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [entries, proofreadFilePath, proofreadReady]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      unlisten = await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
        if (locationRef.current !== '/proofreading') {
          setVideoDragOver(false);
          setSrtDragOver(false);
          setProofreadDragOver(false);
          activeDragZoneRef.current = null;
          return;
        }

        const { type } = event.payload;

        if ((type === 'enter' || type === 'over') && 'position' in event.payload) {
          const pos = event.payload.position;
          const cssX = pos.x / window.devicePixelRatio;
          const cssY = pos.y / window.devicePixelRatio;
          const vRect = videoZoneRef.current?.getBoundingClientRect();
          const sRect = srtZoneRef.current?.getBoundingClientRect();
          const pRect = proofreadZoneRef.current?.getBoundingClientRect();
          const inVideo = vRect && cssX >= vRect.left && cssX <= vRect.right && cssY >= vRect.top && cssY <= vRect.bottom;
          const inSrt = sRect && cssX >= sRect.left && cssX <= sRect.right && cssY >= sRect.top && cssY <= sRect.bottom;
          const inProofread = pRect && cssX >= pRect.left && cssX <= pRect.right && cssY >= pRect.top && cssY <= pRect.bottom;
          setVideoDragOver(!!inVideo);
          setSrtDragOver(!!inSrt);
          setProofreadDragOver(!!inProofread);
          activeDragZoneRef.current = inVideo ? 'video' : inSrt ? 'translation' : inProofread ? 'proofread' : null;
        } else if (type === 'leave') {
          setVideoDragOver(false);
          setSrtDragOver(false);
          setProofreadDragOver(false);
          activeDragZoneRef.current = null;
        } else if (type === 'drop' && 'paths' in event.payload) {
          const zone = activeDragZoneRef.current;
          setVideoDragOver(false);
          setSrtDragOver(false);
          setProofreadDragOver(false);
          activeDragZoneRef.current = null;

          for (const filePath of event.payload.paths) {
            const lower = filePath.toLowerCase();
            const isSrt = lower.endsWith('.srt') || lower.endsWith('.vtt');
            if (isSrt && (zone === 'proofread' || (zone === null && looksLikeProofreadFile(filePath)))) {
              const text = await invoke<string>('read_text_file', { path: filePath });
              loadProofreadContent(text, getFileName(filePath), filePath);
            } else if (isSrt && (zone === 'translation' || zone === null)) {
              const text = await invoke<string>('read_text_file', { path: filePath });
              loadTranslationContent(text, getFileName(filePath), filePath);
            } else if (!isSrt && (zone === 'video' || zone === null)) {
              const url = convertFileSrc(filePath);
              const name = getFileName(filePath);
              if (videoUrl) URL.revokeObjectURL(videoUrl);
              setVideoUrl(url);
              setVideoFile(null);
              setVideoFilePath(filePath);
              setVideoFilename(name);
              setPeaks(null);
              setWaveformStatus('idle');
              setCurrentTime(0);
              setIsPlaying(false);
            }
          }
        }
      });
    })();
    return () => { unlisten?.(); };
  }, [loadProofreadContent, loadTranslationContent, videoUrl]);

  const loadBrowserVideo = useCallback((file: File) => {
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

  const handleVideoDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setVideoDragOver(false);
    if (isTauri()) return;
    const file = e.dataTransfer.files[0];
    if (file) loadBrowserVideo(file);
  }, [loadBrowserVideo]);

  const handleSrtDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setSrtDragOver(false);
    if (isTauri()) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    file.text().then((text) => {
      loadTranslationContent(text, file.name, null);
    });
  }, [loadTranslationContent]);

  const handleProofreadDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setProofreadDragOver(false);
    if (isTauri()) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    file.text().then((text) => {
      loadProofreadContent(text, file.name, null);
    });
  }, [loadProofreadContent]);

  const handleBrowseVideo = useCallback(async () => {
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const path = await open({
        multiple: false,
        filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'ts', 'wmv'] }],
      });
      if (typeof path === 'string' && path) {
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        setVideoFile(null);
        setVideoFilePath(path);
        setVideoUrl(convertFileSrc(path));
        setVideoFilename(path.replace(/\\/g, '/').split('/').pop() ?? path);
        setPeaks(null);
        setWaveformStatus('idle');
        setCurrentTime(0);
        setIsPlaying(false);
      }
    } else {
      videoInputRef.current?.click();
    }
  }, [videoUrl]);

  const handleBrowseSrt = useCallback(async () => {
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({
        multiple: false,
        filters: [{ name: 'Subtitle', extensions: ['srt', 'vtt'] }],
      });
      if (typeof path === 'string' && path) {
        const text = await invoke<string>('read_text_file', { path });
        loadTranslationContent(text, getFileName(path), path);
      }
    } else {
      srtInputRef.current?.click();
    }
  }, [loadTranslationContent]);

  const handleVideoFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadBrowserVideo(file);
  }, [loadBrowserVideo]);

  const handleSrtFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      loadTranslationContent(text, file.name, null);
    });
  }, [loadTranslationContent]);

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

  const clearTranslation = useCallback(() => {
    setTranslationEntries([]);
    setTranslationContent('');
    setTranslationFilePath(null);
    setTranslationFilename('');
  }, []);

  const clearProofread = useCallback(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setEntries([]);
    setProofreadContent('');
    setProofreadFilePath(null);
    setProofreadFilename('');
    setProofreadReady(false);
    setSaveStatus('idle');
    lastSavedContentRef.current = '';
    proofreadDirtyRef.current = false;
  }, []);

  const activateProofreadContent = useCallback((content: string, filename: string, path: string | null) => {
    loadProofreadContent(content, filename, path);
  }, [loadProofreadContent]);

  const createProofreadFile = useCallback(async () => {
    const sourceContent = translationContent || exportSrt(translationEntries, 'bilingual');
    if (isTauri() && translationFilePath) {
      const path = buildProofreadCopyPath(translationFilePath);
      await invoke('save_text_file', { path, content: sourceContent });
      activateProofreadContent(sourceContent, getFileName(path), path);
      return;
    }
    const filename = translationFilename
      ? `${translationFilename.replace(/\.[^.]+$/, '')}_proofread.srt`
      : 'proofread.srt';
    activateProofreadContent(sourceContent, filename, null);
  }, [activateProofreadContent, translationContent, translationEntries, translationFilePath, translationFilename]);

  const importProofreadFile = useCallback(async () => {
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({
        multiple: false,
        filters: [{ name: 'Proofreading Subtitle', extensions: ['srt', 'vtt'] }],
      });
      if (typeof path === 'string' && path) {
        const text = await invoke<string>('read_text_file', { path });
        activateProofreadContent(text, getFileName(path), path);
      }
    } else {
      proofreadInputRef.current?.click();
    }
  }, [activateProofreadContent]);

  const handleProofreadFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      activateProofreadContent(text, file.name, null);
    });
  }, [activateProofreadContent]);

  const handlePlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  }, []);

  useSpacebarPlaybackShortcut(handlePlayPause);

  const seek = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
  }, []);

  const handleSeek = useCallback((time: number) => {
    const v = videoRef.current;
    if (v) { v.currentTime = time; setCurrentTime(time); }
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => {
      const next = (i + 1) % SPEEDS.length;
      if (videoRef.current) videoRef.current.playbackRate = SPEEDS[next];
      return next;
    });
  }, []);

  const updateEntry = (idx: number, changes: Partial<ProofreadEntry>) => {
    proofreadDirtyRef.current = true;
    setEntries((prev) => prev.map((entry, i) => (i === idx ? { ...entry, ...changes } : entry)));
  };

  const handleEntryUpdate = (idx: number, changes: Partial<Pick<SrtEntry, 'startMs' | 'endMs'>>) => {
    updateEntry(idx, changes);
  };

  const createBlankProofreadEntry = (startMs: number, endMs: number): ProofreadEntry => ({
    index: 0,
    startMs,
    endMs,
    originalText: '',
    translatedText: '',
    previousTranslatedText: '',
    proofreadNote: '',
  });

  const handleInsertEntry = (startMs: number) => { proofreadDirtyRef.current = true; setEntries((prev) => insertSubtitleEntry(prev, startMs, createBlankProofreadEntry)); };
  const handleDeleteEntry = (idx: number) => { proofreadDirtyRef.current = true; setEntries((prev) => deleteSubtitleEntry(prev, idx)); };
  const handleMergeWithPrev = (idx: number) => { proofreadDirtyRef.current = true; setEntries((prev) => mergeSubtitleEntries(prev, idx, 'prev', (left, right) => ({
    previousTranslatedText: joinSubtitleText(left.previousTranslatedText, right.previousTranslatedText),
    proofreadNote: [left.proofreadNote, right.proofreadNote].filter((note) => note.trim()).join('\n'),
  }))); };
  const handleMergeWithNext = (idx: number) => { proofreadDirtyRef.current = true; setEntries((prev) => mergeSubtitleEntries(prev, idx, 'next', (left, right) => ({
    previousTranslatedText: joinSubtitleText(left.previousTranslatedText, right.previousTranslatedText),
    proofreadNote: [left.proofreadNote, right.proofreadNote].filter((note) => note.trim()).join('\n'),
  }))); };
  const handleInsertBlankBefore = (idx: number) => {
    const next = insertBlankSubtitleEntry(entries, idx, 'before', duration * 1000, createBlankProofreadEntry);
    if (!next) {
      window.alert(t.translationPage.insertBlankFailed);
      return;
    }
    proofreadDirtyRef.current = true;
    setEntries(next);
  };
  const handleInsertBlankAfter = (idx: number) => {
    const next = insertBlankSubtitleEntry(entries, idx, 'after', duration * 1000, createBlankProofreadEntry);
    if (!next) {
      window.alert(t.translationPage.insertBlankFailed);
      return;
    }
    proofreadDirtyRef.current = true;
    setEntries(next);
  };
  const handleSplitEntry = (idx: number) => {
    proofreadDirtyRef.current = true;
    setEntries(splitSubtitleEntry(entries, idx, (entry) => {
      const previousTranslatedSplit = splitSubtitleText(entry.previousTranslatedText);
      return [
        {
          previousTranslatedText: previousTranslatedSplit.first,
          proofreadNote: entry.proofreadNote,
        },
        {
          previousTranslatedText: previousTranslatedSplit.second,
          proofreadNote: '',
        },
      ];
    }));
  };

  const handleDownloadFfmpeg = useCallback(() => {
    setFfmpegStatus('downloading');
    invoke('download_ffmpeg')
      .then(() => setFfmpegStatus('available'))
      .catch(() => setFfmpegStatus('not-found'));
  }, []);

  const overlayLines: string[] = [];
  if (activeEntry) {
    if (subtitleMode === 'original') overlayLines.push(activeEntry.originalText);
    else if (subtitleMode === 'translated') overlayLines.push(activeEntry.translatedText || activeEntry.originalText);
    else if (subtitleMode === 'both') {
      overlayLines.push(activeEntry.originalText);
      if (activeEntry.translatedText) overlayLines.push(activeEntry.translatedText);
    }
  }

  const hasVideo = !!videoUrl;
  const hasTranslation = translationEntries.length > 0;
  const hasProofreadFile = proofreadReady && entries.length > 0;
  const glossaryEntryCount = countGlossaryEntries(glossaryRows);
  const subtitleModeLabel =
    subtitleMode === 'both'
      ? p.subBoth
      : subtitleMode === 'original'
      ? t.translationPage.subOriginal
      : subtitleMode === 'translated'
      ? p.subTranslated
      : p.subNone;
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

  const exportProofreadNotes = () => {
    const html = buildProofreadNotesHtml(entries, p.notesExportTitle, p.notesExportEmpty, {
      time: p.time,
      original: p.original,
      previousTranslation: p.previousTranslation,
      finalTranslation: p.finalTranslation,
      proofreadNote: p.proofreadNote,
    });
    downloadFile(html, 'proofreading-notes.html', 'text/html;charset=utf-8');
  };

  const exportFinalSubtitle = () => {
    downloadFile(exportFinalSrt(entries), `backup_${proofreadFilename || translationFilename || 'proofread.srt'}`);
    proofreadDirtyRef.current = false;
  };
  const exitDialogMessage = exitDirtyState.proofread && exitDirtyState.glossary
    ? p.exitDialogBothMessage
    : exitDirtyState.glossary
    ? t.translationPage.exitDialogGlossaryMessage
    : p.exitDialogMessage;
  const exitDialogExportLabel = exitDirtyState.proofread && exitDirtyState.glossary
    ? p.exitDialogExportBoth
    : exitDirtyState.glossary
    ? t.translationPage.exitDialogExportGlossary
    : p.exitDialogExport;
  const handleExportAndClose = () => {
    if (exitDirtyState.proofread) {
      downloadFile(exportFinalSrt(entries), `backup_${proofreadFilename || translationFilename || 'proofread.srt'}`);
      proofreadDirtyRef.current = false;
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
  const exitDialog = showExitDialog && (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="flex w-[420px] max-w-[92vw] flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t.translationPage.exitDialogTitle}</h2>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{exitDialogMessage}</p>
        <div className="flex flex-col gap-2 pt-1">
          <Button className="justify-center" onClick={handleExportAndClose}>
            <Download className="mr-2 h-4 w-4" />{exitDialogExportLabel}
          </Button>
          <Button
            variant="destructive"
            className="justify-center"
            onClick={() => {
              proofreadDirtyRef.current = false;
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
              releaseCloseGuard('proofreading');
              setShowExitDialog(false);
            }}
          >
            {t.translationPage.exitDialogCancel}
          </Button>
        </div>
      </div>
    </div>
  );
  const proofreadingColumns: SubtitleEditColumn<ProofreadEntry>[] = [
    {
      id: 'original',
      label: p.original,
      value: (entry) => entry.originalText,
      onChange: (idx, value) => updateEntry(idx, { originalText: value }),
    },
    {
      id: 'previous-translation',
      label: p.previousTranslation,
      value: (entry) => entry.previousTranslatedText,
      tone: 'muted',
    },
    {
      id: 'final-translation',
      label: p.finalTranslation,
      value: (entry) => entry.translatedText,
      onChange: (idx, value) => updateEntry(idx, { translatedText: value }),
      placeholder: p.translationPlaceholder,
      cellClassName: (entry) => (
        entry.previousTranslatedText.trim() !== entry.translatedText.trim() ? 'bg-emerald-500/5' : ''
      ),
    },
    {
      id: 'proofread-note',
      label: p.proofreadNote,
      value: (entry) => entry.proofreadNote,
      onChange: (idx, value) => updateEntry(idx, { proofreadNote: value }),
      tone: 'note',
    },
  ];

  if (!hasVideo || !hasTranslation || !hasProofreadFile) {
    return (
      <div className="flex h-full flex-col gap-6 p-6">
        <div>
          <h1 className="text-xl font-bold">{p.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{p.subtitle}</p>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-4 content-start lg:grid-cols-3">
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*,.mkv,.mp4,.mov,.avi,.ts,.wmv"
            className="sr-only"
            onChange={handleVideoFileChange}
          />
          <input
            ref={srtInputRef}
            type="file"
            accept=".srt,.vtt"
            className="sr-only"
            onChange={handleSrtFileChange}
          />
          <input
            ref={proofreadInputRef}
            type="file"
            accept=".srt,.vtt"
            className="sr-only"
            onChange={handleProofreadFileChange}
          />
          <DropZone
            label={t.translationPage.dropVideoHere}
            hint={t.translationPage.dropVideoHint}
            browseLabel={t.translationPage.browseFile}
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
            label={p.dropTranslation}
            hint={p.dropTranslationHint}
            browseLabel={t.translationPage.browseFile}
            isOver={srtDragOver}
            isLoaded={!!translationFilename}
            loadedName={translationFilename}
            icon={<FileText className="h-6 w-6 text-muted-foreground" />}
            zoneRef={srtZoneRef}
            onDragOver={(e) => { e.preventDefault(); if (!isTauri()) setSrtDragOver(true); }}
            onDragLeave={() => { if (!isTauri()) setSrtDragOver(false); }}
            onDrop={handleSrtDrop}
            onBrowse={handleBrowseSrt}
            onClear={translationFilename ? clearTranslation : undefined}
          />
          <DropZone
            label={p.proofreadingFileTitle}
            hint={proofreadFilename ? p.proofreadFileReady : p.proofreadingFileHint}
            browseLabel={p.importProofreadFile}
            isOver={proofreadDragOver}
            isLoaded={!!proofreadFilename}
            loadedName={proofreadFilename}
            icon={<CheckSquare className="h-6 w-6 text-muted-foreground" />}
            zoneRef={proofreadZoneRef}
            onDragOver={(e) => { e.preventDefault(); if (!isTauri()) setProofreadDragOver(true); }}
            onDragLeave={() => { if (!isTauri()) setProofreadDragOver(false); }}
            onDrop={handleProofreadDrop}
            onBrowse={importProofreadFile}
            onClear={proofreadFilename ? clearProofread : undefined}
          />
        </div>
        {hasTranslation && !hasProofreadFile && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">{p.proofreadingFileHint}</span>
            <Button size="sm" onClick={createProofreadFile}>
              <FilePlus2 className="mr-1.5 h-4 w-4" />{p.createProofreadFile}
            </Button>
          </div>
        )}
        {exitDialog}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-card/50 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="max-w-[180px] truncate text-xs font-medium">{videoFilename}</span>
          <button type="button" onClick={clearVideo} className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
          <span className="mx-1 text-muted-foreground/40">/</span>
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="max-w-[180px] truncate text-xs text-muted-foreground">{translationFilename}</span>
          <button type="button" onClick={clearTranslation} className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
          <span className="mx-1 text-muted-foreground/40">/</span>
          <CheckSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="max-w-[180px] truncate text-xs text-muted-foreground">{proofreadFilename}</span>
          <button type="button" onClick={clearProofread} className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {proofreadFilePath
              ? saveStatus === 'saving'
                ? p.autosaveSaving
                : saveStatus === 'error'
                ? p.autosaveError
                : p.autosaveSaved
              : p.autosaveBrowser}
          </span>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={toggleWorkspaceLayout}>
          {isSideLayout ? <Rows3 className="mr-1 h-3 w-3" /> : <Columns2 className="mr-1 h-3 w-3" />}
          {isSideLayout ? t.translationPage.layoutStacked : t.translationPage.layoutSideBySide}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportFinalSubtitle}>
          <Download className="mr-1 h-3 w-3" />{p.exportFinal}
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={exportProofreadNotes} disabled={exportableCount === 0}>
          <CheckSquare className="mr-1 h-3 w-3" />{p.exportNotes}
          {exportableCount > 0 && (
            <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 font-mono text-[10px] leading-none">
              {exportableCount}
            </span>
          )}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowGlossary(true)}>
          <BookOpen className="mr-1 h-3 w-3" />{t.translationPage.glossaryButton}
          {glossaryEntryCount > 0 && (
            <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.5 font-mono text-[10px] leading-none text-primary">
              {glossaryEntryCount}
            </span>
          )}
        </Button>
      </div>

      {showGlossary && (
        <GlossaryDialog
          rows={glossaryRows}
          onRowsChange={handleGlossaryRowsChange}
          onExported={() => { glossaryDirtyRef.current = false; }}
          onClose={() => setShowGlossary(false)}
        />
      )}
      {exitDialog}

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
            speedLabel={`${SPEEDS[speedIdx]}x`}
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
            srtEntries={entries}
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
            entries={entries}
            activeIdx={activeIdx}
            columns={proofreadingColumns}
            gridTemplateColumns="minmax(200px,1fr) minmax(220px,1.05fr) minmax(220px,1.05fr) minmax(220px,0.9fr)"
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
    </div>
  );
}
