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
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Download,
  Film,
  FileText,
  X,
  BookOpen,
  Columns2,
  Rows3,
  Languages,
  Package,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wifi,
  Trash2,
  FolderOpen,
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
type MachineTranslationStatus =
  | { kind: 'idle' }
  | { kind: 'translating'; completed: number; total: number; message?: string }
  | { kind: 'done'; count: number }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string };

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
const MACHINE_TRANSLATION_ENDPOINT_KEY = 'qafone-machine-translation-endpoint';
const MACHINE_TRANSLATION_SOURCE_LANG_KEY = 'qafone-machine-translation-source-lang';
const MACHINE_TRANSLATION_TARGET_LANG_KEY = 'qafone-machine-translation-target-lang';
const MACHINE_TRANSLATION_FORMATTING_KEY = 'qafone-machine-translation-formatting';
const MACHINE_TRANSLATION_POLISHING_KEY = 'qafone-machine-translation-polishing';
const LOCAL_NLLB_ENDPOINT = 'qafone://local-nllb';
const LEGACY_MACHINE_TRANSLATION_ENDPOINT = 'http://127.0.0.1:8765/translate';
const DEFAULT_MACHINE_TRANSLATION_ENDPOINT = LOCAL_NLLB_ENDPOINT;
const MACHINE_TRANSLATION_BATCH_SIZE = 4;
const POLISH_BATCH_SIZE = 1;
const NLLB_MODEL_ID = 'nllb-200-distilled-600M';
const NLLB_MODEL_NAME = 'NLLB-200 Distilled 600M';
const NLLB_MODEL_SIZE_LABEL = '2.5 GB';
const NLLB_MODEL_SIZE_BYTES = 2_520_000_000;
const DEFAULT_POLISH_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions';
const DEFAULT_POLISH_MODEL = 'qwen3.5:4b';
const DEFAULT_POLISH_PROMPT = `你是专业影视字幕翻译编辑。

请润色下面字幕：

要求：
- 保持原意
- 保持口语化
- 所有标点符号均使用半角英文
- 英文逗号后请添加一个空格（如果逗号前后都是数字或逗号/句号等标点，则不添加空格）
- 删除句末的句号（如果有的话）
- 不要解释
- 不要增加内容
- 只输出最终字幕`;

const MACHINE_TRANSLATION_LANGUAGES = [
  { code: 'eng_Latn', label: 'English' },
  { code: 'jpn_Jpan', label: 'Japanese' },
  { code: 'kor_Hang', label: 'Korean' },
  { code: 'zho_Hans', label: 'Chinese Simplified' },
  { code: 'zho_Hant', label: 'Chinese Traditional' },
  { code: 'fra_Latn', label: 'French' },
  { code: 'deu_Latn', label: 'German' },
  { code: 'spa_Latn', label: 'Spanish' },
  { code: 'rus_Cyrl', label: 'Russian' },
];

const POLISH_MODELS = ['qwen3.5:4b', 'qwen3.6', 'gemma4'];

interface MachineTranslationFormatting {
  spaceAfterComma: boolean;
  removeSentenceFinalPeriod: boolean;
}

interface MachineTranslationPolishing {
  enabled: boolean;
  endpoint: string;
  model: string;
  prompt: string;
  contextWindow: number;
}

const DEFAULT_MACHINE_TRANSLATION_POLISHING: MachineTranslationPolishing = {
  enabled: false,
  endpoint: DEFAULT_POLISH_ENDPOINT,
  model: DEFAULT_POLISH_MODEL,
  prompt: DEFAULT_POLISH_PROMPT,
  contextWindow: 2,
};

const DEFAULT_MACHINE_TRANSLATION_FORMATTING: MachineTranslationFormatting = {
  spaceAfterComma: true,
  removeSentenceFinalPeriod: true,
};

interface DownloadProgressPayload {
  model_id: string;
  downloaded: number;
  total: number;
  percentage: number;
  speed_bps: number;
  cdn_source: string;
}

interface NllbRuntimeStatus {
  ready: boolean;
  runtime_dir: string;
  python_path: string | null;
  missing_packages: string[];
  message: string;
}

interface NllbRuntimeInstallProgress {
  phase: string;
  message: string;
}

interface NllbTranslationProgress {
  phase: string;
  message: string;
}

interface PolishContextItem {
  source_text: string;
  draft_text: string;
}

interface PolishRequestItem {
  index: number;
  source_text: string;
  draft_text: string;
  previous: PolishContextItem[];
  next: PolishContextItem[];
}

type ModelStatus = 'checking' | 'available' | 'not-found';

interface DownloadState {
  phase: 'idle' | 'speed-testing' | 'downloading' | 'done';
  percentage: number;
  speedBps: number;
  cdnSource: string;
  downloadedBytes: number;
  totalBytes: number;
}

const INITIAL_DOWNLOAD_STATE: DownloadState = {
  phase: 'idle',
  percentage: 0,
  speedBps: 0,
  cdnSource: '',
  downloadedBytes: 0,
  totalBytes: 0,
};

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

function addSpaceAfterComma(text: string): string {
  return text.replace(/,(\S)/g, (match, next: string, offset: number, input: string) => {
    const previous = input[offset - 1] ?? '';
    if (/\d/.test(previous) && /\d/.test(next)) return match;
    if (/[,.;:!?，。]/u.test(next)) return match;
    return `, ${next}`;
  });
}

function removeSentenceFinalPeriod(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[。.]$/u, ''))
    .join('\n');
}

function formatMachineTranslation(text: string, rules: MachineTranslationFormatting): string {
  let formatted = text.trim();
  if (rules.spaceAfterComma) formatted = addSpaceAfterComma(formatted);
  if (rules.removeSentenceFinalPeriod) formatted = removeSentenceFinalPeriod(formatted);
  return formatted;
}

function pickTranslationString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const keys = ['translation_text', 'translated_text', 'translatedText', 'translation', 'text', 'output', 'result'];
  for (const key of keys) {
    const item = record[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return null;
}

function pickTranslationArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const translations = value.map(pickTranslationString).filter((item): item is string => !!item);
  return translations.length > 0 ? translations : null;
}

function extractMachineTranslations(value: unknown, expected: number): string[] {
  const rootArray = pickTranslationArray(value);
  if (rootArray) return rootArray;

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = ['translations', 'translated_texts', 'translatedTexts', 'outputs', 'results', 'data', 'items', 'texts'];
    for (const key of keys) {
      const translations = pickTranslationArray(record[key]);
      if (translations) return translations;
    }
  }

  const single = expected === 1 ? pickTranslationString(value) : null;
  if (single) return [single];
  throw new Error('No translations found in response');
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
  const se = t.subtitleExtraction;
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
  const [machineTranslationEndpoint, setMachineTranslationEndpoint] = useState(() => {
    try {
      return localStorage.getItem(MACHINE_TRANSLATION_ENDPOINT_KEY) || DEFAULT_MACHINE_TRANSLATION_ENDPOINT;
    } catch {
      return DEFAULT_MACHINE_TRANSLATION_ENDPOINT;
    }
  });
  const [machineTranslationSourceLang, setMachineTranslationSourceLang] = useState(() => {
    try {
      return localStorage.getItem(MACHINE_TRANSLATION_SOURCE_LANG_KEY) || 'eng_Latn';
    } catch {
      return 'eng_Latn';
    }
  });
  const [machineTranslationTargetLang, setMachineTranslationTargetLang] = useState(() => {
    try {
      return localStorage.getItem(MACHINE_TRANSLATION_TARGET_LANG_KEY) || 'zho_Hans';
    } catch {
      return 'zho_Hans';
    }
  });
  const [machineTranslationFormatting, setMachineTranslationFormatting] = useState<MachineTranslationFormatting>(() => {
    try {
      const raw = localStorage.getItem(MACHINE_TRANSLATION_FORMATTING_KEY);
      return raw
        ? { ...DEFAULT_MACHINE_TRANSLATION_FORMATTING, ...JSON.parse(raw) as Partial<MachineTranslationFormatting> }
        : DEFAULT_MACHINE_TRANSLATION_FORMATTING;
    } catch {
      return DEFAULT_MACHINE_TRANSLATION_FORMATTING;
    }
  });
  const [machineTranslationPolishing, setMachineTranslationPolishing] = useState<MachineTranslationPolishing>(() => {
    try {
      const raw = localStorage.getItem(MACHINE_TRANSLATION_POLISHING_KEY);
      const settings = raw
        ? { ...DEFAULT_MACHINE_TRANSLATION_POLISHING, ...JSON.parse(raw) as Partial<MachineTranslationPolishing> }
        : DEFAULT_MACHINE_TRANSLATION_POLISHING;
      return POLISH_MODELS.includes(settings.model)
        ? settings
        : { ...settings, model: DEFAULT_POLISH_MODEL };
    } catch {
      return DEFAULT_MACHINE_TRANSLATION_POLISHING;
    }
  });
  const [machineTranslationStatus, setMachineTranslationStatus] = useState<MachineTranslationStatus>({ kind: 'idle' });
  const [machineTranslatingRows, setMachineTranslatingRows] = useState<Set<number>>(() => new Set());
  const [nllbModelStatus, setNllbModelStatus] = useState<ModelStatus>('checking');
  const [nllbDownloadState, setNllbDownloadState] = useState<DownloadState>(INITIAL_DOWNLOAD_STATE);
  const [modelDirPath, setModelDirPath] = useState('');
  const [nllbRuntimeStatus, setNllbRuntimeStatus] = useState<NllbRuntimeStatus | null>(null);
  const [nllbRuntimeInstallMessage, setNllbRuntimeInstallMessage] = useState('');
  const [isInstallingNllbRuntime, setIsInstallingNllbRuntime] = useState(false);
  const [isTestingPolishService, setIsTestingPolishService] = useState(false);
  const [showMachineTranslationPanel, setShowMachineTranslationPanel] = useState(false);
  const [showCustomTranslationService, setShowCustomTranslationService] = useState(false);

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

  useEffect(() => {
    try { localStorage.setItem(MACHINE_TRANSLATION_ENDPOINT_KEY, machineTranslationEndpoint); }
    catch { /* storage unavailable */ }
  }, [machineTranslationEndpoint]);

  useEffect(() => {
    try { localStorage.setItem(MACHINE_TRANSLATION_SOURCE_LANG_KEY, machineTranslationSourceLang); }
    catch { /* storage unavailable */ }
  }, [machineTranslationSourceLang]);

  useEffect(() => {
    try { localStorage.setItem(MACHINE_TRANSLATION_TARGET_LANG_KEY, machineTranslationTargetLang); }
    catch { /* storage unavailable */ }
  }, [machineTranslationTargetLang]);

  useEffect(() => {
    try { localStorage.setItem(MACHINE_TRANSLATION_FORMATTING_KEY, JSON.stringify(machineTranslationFormatting)); }
    catch { /* storage unavailable */ }
  }, [machineTranslationFormatting]);

  useEffect(() => {
    try { localStorage.setItem(MACHINE_TRANSLATION_POLISHING_KEY, JSON.stringify(machineTranslationPolishing)); }
    catch { /* storage unavailable */ }
  }, [machineTranslationPolishing]);

  useEffect(() => {
    if (!isTauri()) {
      setNllbModelStatus('not-found');
      return;
    }
    setNllbDownloadState(INITIAL_DOWNLOAD_STATE);
    setNllbModelStatus('checking');
    invoke<boolean>('check_model_status', { modelId: NLLB_MODEL_ID })
      .then((found) => {
        setNllbModelStatus(found ? 'available' : 'not-found');
        if (found) {
          setMachineTranslationEndpoint((endpoint) => (
            !endpoint.trim() || endpoint.trim() === LEGACY_MACHINE_TRANSLATION_ENDPOINT
              ? LOCAL_NLLB_ENDPOINT
              : endpoint
          ));
        }
      })
      .catch(() => setNllbModelStatus('not-found'));
    invoke<string>('get_model_dir_path')
      .then((path) => setModelDirPath(path))
      .catch(() => setModelDirPath(''));
    invoke<NllbRuntimeStatus>('check_nllb_runtime')
      .then(setNllbRuntimeStatus)
      .catch(() => setNllbRuntimeStatus(null));
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<DownloadProgressPayload>('model-download-progress', (event) => {
        const progress = event.payload;
        if (progress.model_id !== NLLB_MODEL_ID) return;
        setNllbDownloadState({
          phase: progress.percentage >= 100 ? 'done' : 'downloading',
          percentage: Math.min(progress.percentage, 100),
          speedBps: progress.speed_bps,
          cdnSource: progress.cdn_source,
          downloadedBytes: progress.downloaded,
          totalBytes: progress.total,
        });
        if (progress.percentage >= 100) {
          window.setTimeout(() => {
            setNllbModelStatus('available');
            setMachineTranslationEndpoint((endpoint) => (
              !endpoint.trim() || endpoint.trim() === LEGACY_MACHINE_TRANSLATION_ENDPOINT
                ? LOCAL_NLLB_ENDPOINT
                : endpoint
            ));
          }, 600);
        }
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    if (machineTranslationStatus.kind !== 'done') return;
    const timer = window.setTimeout(() => setShowMachineTranslationPanel(false), 1400);
    return () => window.clearTimeout(timer);
  }, [machineTranslationStatus]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<NllbTranslationProgress>('nllb-translation-progress', (event) => {
        setMachineTranslationStatus((status) => (
          status.kind === 'translating'
            ? { ...status, message: event.payload.message }
            : status
        ));
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<NllbRuntimeInstallProgress>('nllb-runtime-install-progress', (event) => {
        setNllbRuntimeInstallMessage(event.payload.message);
      });
    })();
    return () => { unlisten?.(); };
  }, []);

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

  const handleDownloadNllbModel = useCallback(async () => {
    setNllbDownloadState({ ...INITIAL_DOWNLOAD_STATE, phase: 'speed-testing', totalBytes: NLLB_MODEL_SIZE_BYTES });
    if (!isTauri()) {
      window.setTimeout(() => {
        setNllbDownloadState({
          phase: 'done',
          percentage: 100,
          speedBps: 0,
          cdnSource: 'huggingface',
          downloadedBytes: NLLB_MODEL_SIZE_BYTES,
          totalBytes: NLLB_MODEL_SIZE_BYTES,
        });
        setNllbModelStatus('available');
      }, 800);
      return;
    }

    try {
      await invoke('download_model', { modelId: NLLB_MODEL_ID, totalSize: NLLB_MODEL_SIZE_BYTES });
      setNllbDownloadState((prev) => ({ ...prev, phase: 'done', percentage: 100 }));
      window.setTimeout(() => {
        setNllbModelStatus('available');
        setMachineTranslationEndpoint((endpoint) => (
          !endpoint.trim() || endpoint.trim() === LEGACY_MACHINE_TRANSLATION_ENDPOINT
            ? LOCAL_NLLB_ENDPOINT
            : endpoint
        ));
      }, 600);
    } catch (error) {
      console.error('NLLB model download failed:', error);
      setNllbDownloadState(INITIAL_DOWNLOAD_STATE);
      setNllbModelStatus('not-found');
    }
  }, []);

  const handleDeleteNllbModel = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invoke('delete_model', { modelId: NLLB_MODEL_ID });
      setNllbModelStatus('not-found');
      setNllbDownloadState(INITIAL_DOWNLOAD_STATE);
    } catch (error) {
      console.error('NLLB model delete failed:', error);
    }
  }, []);

  const handleOpenModelDir = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const path = modelDirPath || await invoke<string>('get_model_dir_path');
      await invoke('open_path', { path });
    } catch (error) {
      console.error('Open model directory failed:', error);
    }
  }, [modelDirPath]);

  const ensureNllbRuntimeReady = useCallback(async () => {
    if (!isTauri()) return true;
    const status = await invoke<NllbRuntimeStatus>('check_nllb_runtime');
    setNllbRuntimeStatus(status);
    if (status.ready) return true;

    const missing = status.missing_packages.length > 0
      ? status.missing_packages.join(', ')
      : 'Python runtime';
    const confirmed = window.confirm(
      t.translationPage.nllbRuntimeInstallConfirm
        .replace('{missing}', missing)
        .replace('{path}', status.runtime_dir),
    );
    if (!confirmed) return false;

    setIsInstallingNllbRuntime(true);
    setNllbRuntimeInstallMessage(t.translationPage.nllbRuntimeInstalling);
    try {
      const installed = await invoke<NllbRuntimeStatus>('install_nllb_runtime');
      setNllbRuntimeStatus(installed);
      return installed.ready;
    } finally {
      setIsInstallingNllbRuntime(false);
    }
  }, [t.translationPage.nllbRuntimeInstallConfirm, t.translationPage.nllbRuntimeInstalling]);

  const requestMachineTranslations = useCallback(async (texts: string[]) => {
    const endpoint = machineTranslationEndpoint.trim();
    if (isTauri()) {
      if (endpoint === LOCAL_NLLB_ENDPOINT) {
        const ready = await ensureNllbRuntimeReady();
        if (!ready) throw new Error(t.translationPage.nllbRuntimeNotReady);
      }
      return invoke<string[]>('translate_texts', {
        endpoint,
        sourceLang: machineTranslationSourceLang,
        targetLang: machineTranslationTargetLang,
        texts,
      });
    }
    if (endpoint === LOCAL_NLLB_ENDPOINT) {
      throw new Error('Local NLLB translation is available only in the Tauri desktop app.');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts,
        source_lang: machineTranslationSourceLang,
        target_lang: machineTranslationTargetLang,
        source: machineTranslationSourceLang,
        target: machineTranslationTargetLang,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const translations = extractMachineTranslations(data, texts.length);
    if (translations.length !== texts.length) {
      throw new Error(`Expected ${texts.length} translations, got ${translations.length}`);
    }
    return translations;
  }, [
    ensureNllbRuntimeReady,
    machineTranslationEndpoint,
    machineTranslationSourceLang,
    machineTranslationTargetLang,
    t.translationPage.nllbRuntimeNotReady,
  ]);

  const requestPolishedTranslations = useCallback(async (
    batch: Array<{ idx: number; sourceText: string; draftText: string }>,
    draftByIndex: Map<number, string>,
    force = false,
  ) => {
    if (!force && !machineTranslationPolishing.enabled) return batch.map((item) => item.draftText);

    const contextWindow = Math.max(0, Math.min(6, machineTranslationPolishing.contextWindow));
    const contextForIndex = (idx: number, direction: 'previous' | 'next'): PolishContextItem[] => {
      const items: PolishContextItem[] = [];
      for (let offset = 1; offset <= contextWindow; offset += 1) {
        const contextIdx = direction === 'previous' ? idx - offset : idx + offset;
        const entry = srtEntries[contextIdx];
        if (!entry) continue;
        items.push({
          source_text: entry.originalText,
          draft_text: draftByIndex.get(contextIdx) ?? entry.translatedText,
        });
      }
      return direction === 'previous' ? items.reverse() : items;
    };

    const items: PolishRequestItem[] = batch.map((item) => ({
      index: item.idx + 1,
      source_text: item.sourceText,
      draft_text: item.draftText,
      previous: contextForIndex(item.idx, 'previous'),
      next: contextForIndex(item.idx, 'next'),
    }));

    if (isTauri()) {
      return invoke<string[]>('polish_translations', {
        endpoint: machineTranslationPolishing.endpoint,
        model: machineTranslationPolishing.model,
        prompt: machineTranslationPolishing.prompt,
        items,
      });
    }

    throw new Error('LLM polishing is available only in the Tauri desktop app.');
  }, [machineTranslationPolishing, srtEntries]);

  const handleMachineTranslateRows = useCallback(async (indexes: number[]) => {
    const endpoint = machineTranslationEndpoint.trim();
    if (!endpoint) {
      setMachineTranslationStatus({ kind: 'error', message: t.translationPage.machineTranslateNoEndpoint });
      return;
    }

    const targets = indexes
      .map((idx) => ({ idx, text: srtEntries[idx]?.originalText.trim() ?? '' }))
      .filter((item) => item.text);
    if (targets.length === 0) return;

    setMachineTranslatingRows(new Set(targets.map((item) => item.idx)));
    setMachineTranslationStatus({ kind: 'translating', completed: 0, total: targets.length });

    let completed = 0;
    try {
      for (let start = 0; start < targets.length; start += MACHINE_TRANSLATION_BATCH_SIZE) {
        const batch = targets.slice(start, start + MACHINE_TRANSLATION_BATCH_SIZE);
        setMachineTranslationStatus({
          kind: 'translating',
          completed,
          total: targets.length,
          message: t.translationPage.machineTranslateBatch
            .replace('{from}', String(start + 1))
            .replace('{to}', String(Math.min(start + batch.length, targets.length)))
            .replace('{total}', String(targets.length)),
        });
        const draftTranslations = await requestMachineTranslations(batch.map((item) => item.text));
        const draftByIndex = new Map<number, string>();
        batch.forEach((item, i) => draftByIndex.set(item.idx, draftTranslations[i] ?? ''));
        const polishedTranslations = machineTranslationPolishing.enabled
          ? await (async () => {
              const results: string[] = [];
              for (let offset = 0; offset < batch.length; offset += POLISH_BATCH_SIZE) {
                const polishBatch = batch.slice(offset, offset + POLISH_BATCH_SIZE);
                setMachineTranslationStatus({
                  kind: 'translating',
                  completed: completed + offset,
                  total: targets.length,
                  message: t.translationPage.machineTranslatePolishingLine
                    .replace('{current}', String(start + offset + 1))
                    .replace('{total}', String(targets.length))
                    .replace('{model}', machineTranslationPolishing.model),
                });
                const polished = await requestPolishedTranslations(
                  polishBatch.map((item) => ({
                    idx: item.idx,
                    sourceText: item.text,
                    draftText: draftByIndex.get(item.idx) ?? '',
                  })),
                  draftByIndex,
                );
                results.push(...polished);
              }
              return batch.map((_, i) => results[i] ?? draftTranslations[i] ?? '');
            })()
          : draftTranslations;
        const translatedByIndex = new Map<number, string>();
        batch.forEach((item, i) => translatedByIndex.set(
          item.idx,
          formatMachineTranslation(polishedTranslations[i] ?? '', machineTranslationFormatting),
        ));

        subtitleDirtyRef.current = true;
        setSrtEntries((prev) => prev.map((entry, idx) => (
          translatedByIndex.has(idx) ? { ...entry, translatedText: translatedByIndex.get(idx) ?? entry.translatedText } : entry
        )));
        completed += batch.length;
        setMachineTranslationStatus({ kind: 'translating', completed, total: targets.length });
        setMachineTranslatingRows((prev) => {
          const next = new Set(prev);
          batch.forEach((item) => next.delete(item.idx));
          return next;
        });
      }
      setMachineTranslationStatus({ kind: 'done', count: completed });
    } catch (error) {
      setMachineTranslationStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setMachineTranslatingRows(new Set());
    }
  }, [
    machineTranslationEndpoint,
    machineTranslationFormatting,
    machineTranslationPolishing.endpoint,
    machineTranslationPolishing.enabled,
    machineTranslationPolishing.model,
    requestPolishedTranslations,
    requestMachineTranslations,
    srtEntries,
    t.translationPage.machineTranslateBatch,
    t.translationPage.machineTranslateNoEndpoint,
    t.translationPage.machineTranslatePolishingLine,
    t.translationPage.machineTranslatePolishingModel,
  ]);

  const handleMachineTranslateAll = useCallback(() => {
    const indexes = srtEntries
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => entry.originalText.trim())
      .map(({ idx }) => idx);
    if (indexes.length === 0) return;
    const hasExistingTranslations = indexes.some((idx) => srtEntries[idx]?.translatedText.trim());
    if (hasExistingTranslations && !window.confirm(t.translationPage.machineTranslateOverwriteConfirm)) return;
    void handleMachineTranslateRows(indexes);
  }, [handleMachineTranslateRows, srtEntries, t.translationPage.machineTranslateOverwriteConfirm]);

  const handlePolishRows = useCallback(async (indexes: number[]) => {
    const targets = indexes
      .map((idx) => ({
        idx,
        sourceText: srtEntries[idx]?.originalText.trim() ?? '',
        draftText: srtEntries[idx]?.translatedText.trim() ?? '',
      }))
      .filter((item) => item.sourceText && item.draftText);
    if (targets.length === 0) {
      setMachineTranslationStatus({ kind: 'error', message: t.translationPage.machineTranslateNoTranslationToPolish });
      return;
    }

    setShowMachineTranslationPanel(true);
    setMachineTranslatingRows(new Set(targets.map((item) => item.idx)));
    const polishingMessage = t.translationPage.machineTranslatePolishingModel
      .replace('{endpoint}', machineTranslationPolishing.endpoint)
      .replace('{model}', machineTranslationPolishing.model);
    setMachineTranslationStatus({ kind: 'translating', completed: 0, total: targets.length, message: polishingMessage });

    let completed = 0;
    try {
      for (let start = 0; start < targets.length; start += POLISH_BATCH_SIZE) {
        const batch = targets.slice(start, start + POLISH_BATCH_SIZE);
        const draftByIndex = new Map<number, string>();
        batch.forEach((item) => draftByIndex.set(item.idx, item.draftText));

        setMachineTranslationStatus({
          kind: 'translating',
          completed,
          total: targets.length,
          message: t.translationPage.machineTranslatePolishingLine
            .replace('{current}', String(start + 1))
            .replace('{total}', String(targets.length))
            .replace('{model}', machineTranslationPolishing.model),
        });

        const polished = await requestPolishedTranslations(batch, draftByIndex, true);
        const polishedByIndex = new Map<number, string>();
        batch.forEach((item, i) => polishedByIndex.set(
          item.idx,
          formatMachineTranslation(polished[i] ?? item.draftText, machineTranslationFormatting),
        ));

        subtitleDirtyRef.current = true;
        setSrtEntries((prev) => prev.map((entry, idx) => (
          polishedByIndex.has(idx) ? { ...entry, translatedText: polishedByIndex.get(idx) ?? entry.translatedText } : entry
        )));

        completed += batch.length;
        setMachineTranslationStatus({ kind: 'translating', completed, total: targets.length, message: polishingMessage });
        setMachineTranslatingRows((prev) => {
          const next = new Set(prev);
          batch.forEach((item) => next.delete(item.idx));
          return next;
        });
      }
      setMachineTranslationStatus({ kind: 'done', count: completed });
    } catch (error) {
      setMachineTranslationStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setMachineTranslatingRows(new Set());
    }
  }, [
    machineTranslationFormatting,
    machineTranslationPolishing.endpoint,
    machineTranslationPolishing.model,
    requestPolishedTranslations,
    srtEntries,
    t.translationPage.machineTranslateNoTranslationToPolish,
    t.translationPage.machineTranslatePolishingLine,
    t.translationPage.machineTranslatePolishingModel,
  ]);

  const handlePolishCurrent = useCallback(() => {
    if (activeIdx < 0) return;
    void handlePolishRows([activeIdx]);
  }, [activeIdx, handlePolishRows]);

  const handlePolishAll = useCallback(() => {
    const indexes = srtEntries
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => entry.originalText.trim() && entry.translatedText.trim())
      .map(({ idx }) => idx);
    void handlePolishRows(indexes);
  }, [handlePolishRows, srtEntries]);

  const handleTestPolishService = useCallback(async () => {
    if (!isTauri()) {
      setMachineTranslationStatus({ kind: 'error', message: 'LLM polishing is available only in the Tauri desktop app.' });
      return;
    }

    setIsTestingPolishService(true);
    setMachineTranslationStatus({ kind: 'info', message: t.translationPage.machineTranslatePolishTesting });
    try {
      const message = await invoke<string>('check_polish_service', {
        endpoint: machineTranslationPolishing.endpoint,
        model: machineTranslationPolishing.model,
      });
      setMachineTranslationStatus({ kind: 'info', message });
    } catch (error) {
      setMachineTranslationStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsTestingPolishService(false);
    }
  }, [
    machineTranslationPolishing.endpoint,
    machineTranslationPolishing.model,
    t.translationPage.machineTranslatePolishTesting,
  ]);

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
  const isMachineTranslationRunning = machineTranslationStatus.kind === 'translating' || isTestingPolishService;
  const isNllbDownloading = nllbDownloadState.phase === 'speed-testing' || nllbDownloadState.phase === 'downloading';
  const nllbModelPath = modelDirPath ? `${modelDirPath.replace(/[/\\]$/, '')}/${NLLB_MODEL_ID}` : '';
  const machineTranslationStatusLabel =
    machineTranslationStatus.kind === 'translating'
      ? t.translationPage.machineTranslateProgress
          .replace('{completed}', String(machineTranslationStatus.completed))
          .replace('{total}', String(machineTranslationStatus.total)) +
        (machineTranslationStatus.message ? ` · ${machineTranslationStatus.message}` : '')
      : machineTranslationStatus.kind === 'done'
      ? t.translationPage.machineTranslateDone.replace('{count}', String(machineTranslationStatus.count))
      : machineTranslationStatus.kind === 'info'
      ? machineTranslationStatus.message
      : machineTranslationStatus.kind === 'error'
      ? `${t.translationPage.machineTranslateError}: ${machineTranslationStatus.message}`
      : '';

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
        <Button
          size="sm"
          variant={showMachineTranslationPanel || isMachineTranslationRunning ? 'default' : 'outline'}
          className="h-7 text-xs"
          onClick={() => setShowMachineTranslationPanel((show) => !show)}
        >
          <Languages className="h-3 w-3 mr-1" />{t.translationPage.machineTranslatePanel}
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

        <div className="relative flex min-h-0 flex-1 flex-col">
          {showMachineTranslationPanel && (
          <div className="absolute right-3 top-3 z-40 flex max-h-[calc(100%-24px)] w-[min(760px,calc(100%-24px))] flex-wrap items-center gap-2 overflow-y-auto rounded-md border border-border bg-card/95 px-3 py-2 shadow-xl backdrop-blur">
            <div className="flex w-full items-center gap-2 border-b border-border/60 pb-2">
              <Languages className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold">{t.translationPage.machineTranslatePanel}</span>
              <div className="flex-1" />
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setShowMachineTranslationPanel(false)}
                title={t.translationPage.machineTranslatePanelClose}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex min-w-[260px] flex-1 flex-wrap items-center gap-2 rounded-md border border-border/70 bg-background/60 px-2 py-1.5">
              {nllbModelStatus === 'checking' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              {nllbModelStatus === 'available' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
              {nllbModelStatus === 'not-found' && <AlertCircle className="h-3.5 w-3.5 text-amber-500" />}
              <div className="min-w-[180px] flex-1">
                <div className="truncate text-xs font-medium">{NLLB_MODEL_NAME}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {nllbModelStatus === 'available'
                    ? `${se.modelAvailable} · ${nllbModelPath || NLLB_MODEL_SIZE_LABEL}`
                    : nllbModelStatus === 'checking'
                    ? se.modelChecking
                    : `${se.modelNotFound} · ${NLLB_MODEL_SIZE_LABEL}`}
                </div>
                <div
                  className={[
                    'truncate text-[11px]',
                    nllbRuntimeStatus?.ready ? 'text-green-500' : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {isInstallingNllbRuntime
                    ? nllbRuntimeInstallMessage || t.translationPage.nllbRuntimeInstalling
                    : nllbRuntimeStatus?.ready
                    ? t.translationPage.nllbRuntimeReady
                    : nllbRuntimeStatus?.message || t.translationPage.nllbRuntimeMissing}
                </div>
              </div>
              {nllbModelStatus === 'not-found' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={handleDownloadNllbModel}
                  disabled={isNllbDownloading || isInstallingNllbRuntime}
                >
                  <Package className="mr-1 h-3 w-3" />{se.downloadModel}
                </Button>
              )}
              {nllbModelStatus === 'available' && (
                <>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleOpenModelDir} disabled={isInstallingNllbRuntime}>
                    <FolderOpen className="mr-1 h-3 w-3" />{se.openModelDir}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-destructive" onClick={handleDeleteNllbModel} disabled={isInstallingNllbRuntime}>
                    <Trash2 className="mr-1 h-3 w-3" />{se.deleteModel}
                  </Button>
                </>
              )}
              {(isNllbDownloading || nllbDownloadState.phase === 'done') && (
                <div className="w-full space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {nllbDownloadState.phase === 'speed-testing' ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        <span>{se.downloadSpeedTesting}</span>
                      </>
                    ) : (
                      <>
                        <Wifi className="h-3 w-3 text-primary" />
                        <span>{se.downloadingFrom}:</span>
                        <span className="font-medium text-foreground">
                          {nllbDownloadState.cdnSource === 'hf-mirror'
                            ? 'HF Mirror'
                            : nllbDownloadState.cdnSource === 'modelscope'
                            ? 'ModelScope'
                            : 'HuggingFace'}
                        </span>
                        {nllbDownloadState.speedBps > 0 && (
                          <span className="ml-auto tabular-nums text-primary">{formatSpeed(nllbDownloadState.speedBps)}</span>
                        )}
                      </>
                    )}
                  </div>
                  <Progress value={nllbDownloadState.percentage} className="h-1.5" />
                  <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
                    <span>{formatBytes(nllbDownloadState.downloadedBytes)}</span>
                    <span className="font-semibold text-primary">{Math.round(nllbDownloadState.percentage)}%</span>
                    <span>{formatBytes(nllbDownloadState.totalBytes || NLLB_MODEL_SIZE_BYTES)}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex w-full items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setShowCustomTranslationService((show) => !show)}
              >
                {t.translationPage.machineTranslateAdvanced}
              </Button>
              {machineTranslationEndpoint !== LOCAL_NLLB_ENDPOINT && !showCustomTranslationService && (
                <span className="truncate text-xs text-muted-foreground">
                  {t.translationPage.machineTranslateCustomService}
                </span>
              )}
            </div>
            {showCustomTranslationService && (
              <div className="flex w-full flex-wrap items-center gap-2">
                <Input
                  value={machineTranslationEndpoint}
                  onChange={(event) => setMachineTranslationEndpoint(event.target.value)}
                  placeholder={t.translationPage.machineTranslateEndpointPlaceholder}
                  className="h-8 min-w-[220px] flex-1 text-xs"
                  disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => {
                    setMachineTranslationEndpoint(LOCAL_NLLB_ENDPOINT);
                    setShowCustomTranslationService(false);
                  }}
                  disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
                >
                  {t.translationPage.machineTranslateUseLocal}
                </Button>
              </div>
            )}
            <div className="flex w-full flex-wrap items-center gap-3 rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t.translationPage.machineTranslateFormatting}</span>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={machineTranslationFormatting.spaceAfterComma}
                  onChange={(event) => setMachineTranslationFormatting((rules) => ({
                    ...rules,
                    spaceAfterComma: event.target.checked,
                  }))}
                  disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
                />
                {t.translationPage.machineTranslateSpaceAfterComma}
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={machineTranslationFormatting.removeSentenceFinalPeriod}
                  onChange={(event) => setMachineTranslationFormatting((rules) => ({
                    ...rules,
                    removeSentenceFinalPeriod: event.target.checked,
                  }))}
                  disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
                />
                {t.translationPage.machineTranslateRemoveFinalPeriod}
              </label>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={machineTranslationPolishing.enabled}
                  onChange={(event) => setMachineTranslationPolishing((settings) => ({
                    ...settings,
                    enabled: event.target.checked,
                  }))}
                  disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
                />
                {t.translationPage.machineTranslatePolish}
              </label>
              <Input
                    value={machineTranslationPolishing.endpoint}
                    onChange={(event) => setMachineTranslationPolishing((settings) => ({
                      ...settings,
                      endpoint: event.target.value,
                    }))}
                    placeholder={t.translationPage.machineTranslatePolishEndpoint}
                    className="h-8 min-w-[260px] flex-1 text-xs"
                    disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
              />
              <Select
                    value={machineTranslationPolishing.model}
                    onValueChange={(value) => setMachineTranslationPolishing((settings) => ({
                      ...settings,
                      model: value,
                    }))}
                    disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
                  >
                    <SelectTrigger className="h-8 w-[150px] text-xs">
                      <SelectValue placeholder={t.translationPage.machineTranslatePolishModel} />
                    </SelectTrigger>
                    <SelectContent>
                      {POLISH_MODELS.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {t.translationPage.machineTranslateContextWindow}
                    <Input
                      type="number"
                      min={0}
                      max={6}
                      value={machineTranslationPolishing.contextWindow}
                      onChange={(event) => setMachineTranslationPolishing((settings) => ({
                        ...settings,
                        contextWindow: Math.max(0, Math.min(6, Number(event.target.value) || 0)),
                      }))}
                      className="h-8 w-16 text-xs"
                      disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
                    />
              </label>
              <textarea
                    value={machineTranslationPolishing.prompt}
                    onChange={(event) => setMachineTranslationPolishing((settings) => ({
                      ...settings,
                      prompt: event.target.value,
                    }))}
                    className="min-h-[112px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-xs leading-5 outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder={t.translationPage.machineTranslatePolishPrompt}
                    disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
              />
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={handleTestPolishService}
                      disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
                    >
                      {isTestingPolishService && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      {t.translationPage.machineTranslatePolishTest}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={handlePolishCurrent}
                      disabled={isMachineTranslationRunning || isInstallingNllbRuntime || activeIdx < 0}
                    >
                      {t.translationPage.machineTranslatePolishCurrent}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={handlePolishAll}
                      disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
                    >
                      {t.translationPage.machineTranslatePolishAll}
                    </Button>
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2">
              <Select
                value={machineTranslationSourceLang}
                onValueChange={setMachineTranslationSourceLang}
                disabled={isMachineTranslationRunning}
              >
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MACHINE_TRANSLATION_LANGUAGES.map((language) => (
                    <SelectItem key={language.code} value={language.code}>
                      {language.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">→</span>
              <Select
                value={machineTranslationTargetLang}
                onValueChange={setMachineTranslationTargetLang}
                disabled={isMachineTranslationRunning}
              >
                <SelectTrigger className="h-8 w-[170px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MACHINE_TRANSLATION_LANGUAGES.map((language) => (
                    <SelectItem key={language.code} value={language.code}>
                      {language.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => activeIdx >= 0 && void handleMachineTranslateRows([activeIdx])}
                disabled={isMachineTranslationRunning || isInstallingNllbRuntime || activeIdx < 0}
              >
                <Languages className="mr-1 h-3 w-3" />{t.translationPage.machineTranslateCurrent}
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={handleMachineTranslateAll}
                disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
              >
                <Languages className="mr-1 h-3 w-3" />{t.translationPage.machineTranslateAll}
              </Button>
            </div>
            {machineTranslationStatusLabel && (
              <div
                className={[
                  'w-full rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs leading-5',
                  machineTranslationStatus.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
                ].join(' ')}
              >
                {machineTranslationStatusLabel}
              </div>
            )}
          </div>
          )}
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
            rowAction={(_, idx) => (
              <button
                type="button"
                className={[
                  'rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30',
                  machineTranslatingRows.has(idx) ? 'text-primary opacity-100' : '',
                ].join(' ')}
                title={t.translationPage.machineTranslateSentence}
                disabled={isMachineTranslationRunning || isInstallingNllbRuntime}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleMachineTranslateRows([idx]);
                }}
              >
                <Languages className="h-3 w-3" />
              </button>
            )}
          />
        </div>
      </div>

      {/* ── Exit confirmation dialog ─────────────────────────────────────────────── */}
      {exitDialog}
    </div>
  );
}
