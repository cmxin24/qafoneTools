import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { useAsrTask } from '@/contexts/AsrTaskContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/components/ui/utils';
import {
  UploadCloud,
  FileAudio,
  Scissors,
  Download,
  Send,
  ChevronRight,
  CheckCircle2,
  Loader2,
  X,
  Package,
  Cpu,
  Wifi,
  AlertCircle,
  Trash2,
  History,
  FolderOpen,
  Play,
  Pause,
} from 'lucide-react';

// ─── Whisper model catalogue ─────────────────────────────────────────────────
/** Metadata for a supported ASR model (Whisper or Parakeet). */
interface ModelMeta {
  id: string;
  name: string;
  sizeLabel: string;
  sizeBytes: number;
  descEn: string;
  descZh: string;
  /** Inference backend. Determines which sidecar is called. */
  backend: 'whisper' | 'sherpa';
  /** ISO-639 language codes this model supports. Empty = all languages. */
  supportedLanguages?: string[];
}

const LLM_MODELS: ModelMeta[] = [
  {
    id: 'large-v3-turbo',
    name: 'Whisper Large V3 Turbo',
    sizeLabel: '809 MB',
    sizeBytes: 874_188_912,
    descEn: 'multilingual',
    descZh: '多语言',
    backend: 'whisper',
  },
  {
    id: 'parakeet-tdt-0.6b-v3',
    name: 'NVIDIA Parakeet TDT 0.6B v3',
    sizeLabel: '671 MB',
    sizeBytes: 671_000_000,
    descEn: 'English only · Fast · INT8 ONNX · sherpa-onnx',
    descZh: '仅支持英语 · 速度快 · INT8 ONNX',
    backend: 'sherpa',
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────
const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface DownloadProgressPayload {
  model_id: string;
  downloaded: number;
  total: number;
  percentage: number;
  speed_bps: number;
  cdn_source: string;
}

interface AsrProgressPayload {
  phase: string;  // "audio_extract" | "transcribing" | "done" | "error"
  progress: number;
  message: string;
}

export interface AsrSegment {
  index: number;
  start_ms: number;
  end_ms: number;
  text: string;
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

interface DroppedFile {
  name: string;
  size: number;
  path: string | null;      // Absolute path (Tauri only); null in browser
  objectUrl: string | null; // Blob URL for browser-mode playback
}

// ─── Subtitle extraction history ──────────────────────────────────────────────

interface SubtitleHistoryRecord {
  id: string;
  filename: string;
  date: string;       // ISO date string
  model: string;      // model ID used
  segmentCount: number;
  srtContent: string; // full SRT text for restoring results
}

const HISTORY_KEY = 'qafone-subtitle-history';
const MAX_HISTORY = 30;

function loadHistory(): SubtitleHistoryRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as SubtitleHistoryRecord[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(records: SubtitleHistoryRecord[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(records)); }
  catch { /* storage quota */ }
}

function addToHistory(record: Omit<SubtitleHistoryRecord, 'id'>): SubtitleHistoryRecord[] {
  const existing = loadHistory();
  const newRecord: SubtitleHistoryRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  };
  const updated = [newRecord, ...existing].slice(0, MAX_HISTORY);
  saveHistory(updated);
  return updated;
}

/** Parse SRT timecode "HH:MM:SS,mmm" back to milliseconds */
function srtTimecodeToMs(s: string): number {
  const [time, ms] = s.trim().replace(',', '.').split('.');
  const parts = (time ?? '').split(':').map(Number);
  if (parts.length !== 3) return 0;
  return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000 + Number(ms ?? 0);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

/** Format milliseconds → SRT timecode "HH:MM:SS.mmm" (dot as decimal separator for display) */
function msToTimecode(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Format milliseconds → SRT file format "HH:MM:SS,mmm" */
function msToSrtTimecode(ms: number): string {
  return msToTimecode(ms).replace('.', ',');
}

/** Format milliseconds → compact player "M:SS" */
function msToPlayerTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function segmentsToSrt(segments: AsrSegment[]): string {
  return segments
    .map((seg) =>
      `${seg.index}\n${msToSrtTimecode(seg.start_ms)} --> ${msToSrtTimecode(seg.end_ms)}\n${seg.text}\n`
    )
    .join('\n');
}

// ─── Tauri bridge ─────────────────────────────────────────────────────────────
async function tauriCheckModelStatus(modelId: string): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('check_model_status', { modelId });
}

async function tauriDownloadModel(modelId: string, totalSize: number): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('download_model', { modelId, totalSize });
}

async function tauriDeleteModel(modelId: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('delete_model', { modelId });
}

async function tauriGetModelDirPath(): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('get_model_dir_path');
}

async function tauriOpenPath(path: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_path', { path });
}

async function tauriGetFileSize(path: string): Promise<number> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<number>('get_file_size', { path });
}

/**
 * Show a native save-file dialog and write the given text content to the chosen path.
 * In Tauri, we use plugin-dialog to get the path and then invoke a Rust command to
 * write the file (blob/anchor downloads do not work in the Tauri WebView).
 */
async function tauriSaveTextFile(content: string, suggestedName: string): Promise<void> {
  if (!isTauri()) {
    // Fallback for browser dev
    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');
  const path = await save({
    defaultPath: suggestedName,
    filters: [
      { name: 'SRT Subtitle', extensions: ['srt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!path) return; // user cancelled
  await invoke('save_text_file', { path, content });
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function SubtitleExtractionPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const se = t.subtitleExtraction;

  // ── Global ASR task context (persists across navigation) ────────────────────
  const {
    status: extractionStatus,
    progress: asrProgress,
    segments: srtSegments,
    error: asrError,
    startExtraction: ctxStartExtraction,
    cancelExtraction,
    clearTask,
    setSegments: setSrtSegments,
    setStatus,
  } = useAsrTask();

  // ── File state ──────────────────────────────────────────────────────────────
  const [droppedFile, setDroppedFile] = useState<DroppedFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Model state ─────────────────────────────────────────────────────────────
  const [selectedModelId, setSelectedModelId] = useState('large-v3-turbo');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('checking');
  const [downloadState, setDownloadState] = useState<DownloadState>(INITIAL_DOWNLOAD_STATE);

  // ── Segmentation config ─────────────────────────────────────────────────────
  const [maxChars, setMaxChars] = useState(45);
  const [maxWords, setMaxWords] = useState(12);
  const [breakAtPunct, setBreakAtPunct] = useState(true);

  // ── Extraction state ────────────────────────────────────────────────────────
  // (extractionStatus already from context above)

  // ── History state ───────────────────────────────────────────────────────────
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SubtitleHistoryRecord[]>(() => loadHistory());

  // ── Audio player state ──────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioCurrentMs, setAudioCurrentMs] = useState(0);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [activeSegIdx, setActiveSegIdx] = useState(-1);
  const segListRef = useRef<HTMLDivElement>(null);
  const [resolvedAudioSrc, setResolvedAudioSrc] = useState<string | undefined>(undefined);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const selectedModel = LLM_MODELS.find((m) => m.id === selectedModelId)!;
  const isDownloading =
    downloadState.phase === 'speed-testing' || downloadState.phase === 'downloading';

  // ── Resolve audio src ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!droppedFile) { setResolvedAudioSrc(undefined); return; }
    if (droppedFile.objectUrl) { setResolvedAudioSrc(droppedFile.objectUrl); return; }
    if (droppedFile.path && isTauri()) {
      import('@tauri-apps/api/core').then(({ convertFileSrc }) => {
        setResolvedAudioSrc(convertFileSrc(droppedFile.path!));
      });
    }
  }, [droppedFile]);

  // ── Check model status when selection changes ───────────────────────────────
  useEffect(() => {
    setDownloadState(INITIAL_DOWNLOAD_STATE);
    setModelStatus('checking');
    tauriCheckModelStatus(selectedModelId).then((found) =>
      setModelStatus(found ? 'available' : 'not-found')
    );
  }, [selectedModelId]);

  // ── Subscribe to model download progress ────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<DownloadProgressPayload>('model-download-progress', (event) => {
        const p = event.payload;
        if (p.model_id !== selectedModelId) return;
        setDownloadState({
          phase: p.percentage >= 100 ? 'done' : 'downloading',
          percentage: Math.min(p.percentage, 100),
          speedBps: p.speed_bps,
          cdnSource: p.cdn_source,
          downloadedBytes: p.downloaded,
          totalBytes: p.total,
        });
        if (p.percentage >= 100) {
          setTimeout(() => setModelStatus('available'), 600);
        }
      });
    })();
    return () => { unlisten?.(); };
  }, [selectedModelId]);

  // ── Subscribe to ASR progress events ───────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<AsrProgressPayload>('asr-progress', () => { /* handled in AsrTaskContext */ });
    })();
    return () => { unlisten?.(); };
  }, []);

  // ── Tauri drag-drop event (captures actual file path) ──────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
        if (event.payload.type === 'enter') {
          setIsDragging(true);
        } else if (event.payload.type === 'leave') {
          setIsDragging(false);
        } else if (event.payload.type === 'drop') {
          setIsDragging(false);
          const paths: string[] = (event.payload as any).paths ?? [];
          const filePath = paths[0];
          if (!filePath) return;
          const fileName =
            filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath;
          let fileSize = 0;
          try { fileSize = await tauriGetFileSize(filePath); } catch { /* ignore */ }
          setDroppedFile({ name: fileName, size: fileSize, path: filePath, objectUrl: null });
          clearTask();
        }
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  // ── Audio player: sync active segment on time update ───────────────────────
  useEffect(() => {
    if (!srtSegments.length) return;
    const idx = srtSegments.findIndex(
      (seg) => audioCurrentMs >= seg.start_ms && audioCurrentMs < seg.end_ms
    );
    setActiveSegIdx(idx);
    if (idx >= 0 && segListRef.current) {
      const el = segListRef.current.querySelector(`[data-seg-idx="${idx}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [audioCurrentMs, srtSegments]);

  // ── Download handler ────────────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    setDownloadState({ ...INITIAL_DOWNLOAD_STATE, phase: 'speed-testing' });
    if (isTauri()) {
      try {
        await tauriDownloadModel(selectedModelId, selectedModel.sizeBytes);
        // Command returned Ok — all files written. Force transition as a safety
        // net in case the final progress event was <100% due to size estimation.
        setDownloadState((prev) => ({ ...prev, phase: 'done', percentage: 100 }));
        setTimeout(() => setModelStatus('available'), 600);
      } catch (err) {
        console.error('Download failed:', err);
        setDownloadState(INITIAL_DOWNLOAD_STATE);
      }
    } else {
      await new Promise((r) => setTimeout(r, 1200));
      setDownloadState((prev) => ({ ...prev, phase: 'downloading', cdnSource: 'modelscope' }));
      const STEPS = 60;
      for (let i = 1; i <= STEPS; i++) {
        await new Promise((r) => setTimeout(r, 80));
        const pct = (i / STEPS) * 100;
        const downloaded = Math.round((pct / 100) * selectedModel.sizeBytes);
        setDownloadState({
          phase: i === STEPS ? 'done' : 'downloading',
          percentage: pct,
          speedBps: 8_000_000 + Math.random() * 4_000_000,
          cdnSource: 'modelscope',
          downloadedBytes: downloaded,
          totalBytes: selectedModel.sizeBytes,
        });
      }
      setTimeout(() => setModelStatus('available'), 600);
    }
  }, [selectedModelId, selectedModel]);

  // ── Delete model ────────────────────────────────────────────────────────────
  const handleDeleteModel = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await tauriDeleteModel(selectedModelId);
      setModelStatus('not-found');
      setDownloadState(INITIAL_DOWNLOAD_STATE);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [selectedModelId]);

  // ── Open model directory ────────────────────────────────────────────────────
  const handleOpenModelDir = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const dir = await tauriGetModelDirPath();
      await tauriOpenPath(dir);
    } catch (err) {
      console.error('Open dir failed:', err);
    }
  }, []);

  // ── HTML5 drag & drop (browser-only fallback) ───────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!isTauri()) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    if (!isTauri()) setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (isTauri()) return;
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setDroppedFile({ name: file.name, size: file.size, path: null, objectUrl });
      clearTask();
    }
  }, [clearTask]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setDroppedFile({ name: file.name, size: file.size, path: null, objectUrl });
      clearTask();
    }
  }, [clearTask]);

  const handleClearFile = useCallback(() => {
    if (droppedFile?.objectUrl) URL.revokeObjectURL(droppedFile.objectUrl);
    setDroppedFile(null);
    clearTask();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [droppedFile, clearTask]);

  // ── Real extraction ─────────────────────────────────────────────────────────
  const handleStartExtraction = useCallback(async () => {
    if (!droppedFile || modelStatus !== 'available') return;
    await ctxStartExtraction(
      { name: droppedFile.name, size: droppedFile.size, path: droppedFile.path, objectUrl: droppedFile.objectUrl },
      selectedModelId,
    );
  }, [droppedFile, modelStatus, selectedModelId, ctxStartExtraction]);

  // Save to history whenever an extraction succeeds.
  useEffect(() => {
    if (extractionStatus !== 'done' || srtSegments.length === 0) return;
    const fileName = droppedFile?.name ?? 'unknown';
    const newHistory = addToHistory({
      filename: fileName,
      date: new Date().toISOString(),
      model: selectedModelId,
      segmentCount: srtSegments.length,
      srtContent: segmentsToSrt(srtSegments),
    });
    setHistory(newHistory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractionStatus]);

  // ── Export SRT ──────────────────────────────────────────────────────────────
  const handleExportSrt = useCallback(async () => {
    if (!srtSegments.length) return;
    const baseName = droppedFile?.name.replace(/\.[^.]+$/, '') ?? 'subtitles';
    await tauriSaveTextFile(segmentsToSrt(srtSegments), `${baseName}.srt`);
  }, [srtSegments, droppedFile]);

  // ── Send to translation ─────────────────────────────────────────────────────
  const handleSendToTranslation = useCallback(() => {
    if (!srtSegments.length) return;
    sessionStorage.setItem('qafone-pending-srt', segmentsToSrt(srtSegments));
    navigate('/translation');
  }, [srtSegments, navigate]);

  // ── Audio player controls ───────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioPlaying) { audio.pause(); } else { audio.play().catch(() => {}); }
  }, [audioPlaying]);

  const seekToSegment = useCallback((seg: AsrSegment) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seg.start_ms / 1000;
    audio.play().catch(() => {});
  }, []);

  // ── Render helpers ──────────────────────────────────────────────────────────
  const renderActionButton = () => {
    // Always show cancel button when extraction is in progress, even if model
    // status hasn't been determined yet (e.g. after returning to the page).
    if (extractionStatus === 'extracting') {
      return (
        <div className="flex gap-2">
          <Button className="flex-1 gap-2" size="lg" disabled>
            <Loader2 className="h-4 w-4 animate-spin" />{se.extracting}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="gap-2 shrink-0"
            onClick={cancelExtraction}
          >
            <X className="h-4 w-4" />
            取消
          </Button>
        </div>
      );
    }

    if (modelStatus === 'checking') {
      return (
        <Button className="w-full gap-2" size="lg" disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
          {se.modelChecking}
        </Button>
      );
    }

    if (modelStatus === 'not-found') {
      return (
        <Button
          className="w-full gap-2"
          size="lg"
          variant="outline"
          disabled={isDownloading}
          onClick={handleDownload}
        >
          {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {isDownloading
            ? downloadState.phase === 'speed-testing'
              ? se.downloadSpeedTesting
              : `${Math.round(downloadState.percentage)}%`
            : `${se.downloadModel} (${selectedModel.sizeLabel})`}
        </Button>
      );
    }

    if (extractionStatus === 'done') {
      return (
        <div className="space-y-2 animate-in fade-in duration-300">
          <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            <p className="text-sm font-medium text-green-400">{se.extractionComplete}</p>
          </div>
          <Button className="w-full gap-2" variant="outline" onClick={handleExportSrt}>
            <Download className="h-4 w-4" />
            {se.exportSrtFile}
          </Button>
          <Button className="w-full gap-2" onClick={handleSendToTranslation}>
            <Send className="h-4 w-4" />
            {se.sendToTranslation}
            <ChevronRight className="h-4 w-4 ml-auto" />
          </Button>
          <Button
            className="w-full gap-2"
            size="sm"
            variant="ghost"
            onClick={() => { clearTask(); }}
          >
            <Scissors className="h-3.5 w-3.5" />
            重新提取
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {/* English-only reminder for Parakeet (sherpa backend) */}
        {selectedModel.backend === 'sherpa' && (
          <div className="flex items-start gap-2 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2.5">
            <AlertCircle className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
            <span className="text-xs text-muted-foreground">
              Parakeet 仅支持英文音频，其他语言请选择 Whisper 模型。
            </span>
          </div>
        )}
        <Button
          className="w-full gap-2"
          size="lg"
          disabled={!droppedFile}
          onClick={handleStartExtraction}
        >
          <Scissors className="h-4 w-4" />{se.startExtraction}
        </Button>
      </div>
    );
  };

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* History Dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg flex flex-col" style={{ maxHeight: '72vh' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              {se.history}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 mt-2">
            {history.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-10">{se.historyEmpty}</p>
            ) : (
              history.map((rec) => (
                <div key={rec.id} className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors">
                  <FileAudio className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{rec.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(rec.date).toLocaleString()} · {rec.segmentCount} 条字幕 · {rec.model}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        // Parse SRT content back to AsrSegment[]
                        const blocks = rec.srtContent.trim().split(/\n\s*\n/);
                        const segs: AsrSegment[] = blocks.flatMap((block) => {
                          const lines = block.trim().split('\n');
                          if (lines.length < 3) return [];
                          const idx = parseInt(lines[0], 10);
                          const times = lines[1].split(' --> ');
                          if (times.length !== 2) return [];
                          return [{
                            index: idx,
                            start_ms: srtTimecodeToMs(times[0]),
                            end_ms: srtTimecodeToMs(times[1]),
                            text: lines.slice(2).join('\n'),
                          }];
                        });
                        setSrtSegments(segs);
                        setStatus('done');
                        setHistoryOpen(false);
                      }}
                    >
                      {se.historyLoad}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        const updated = history.filter((r) => r.id !== rec.id);
                        setHistory(updated);
                        saveHistory(updated);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
          <Scissors className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">{se.title}</h1>
          <p className="text-sm text-muted-foreground">{se.description}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-2 shrink-0"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="h-3.5 w-3.5" />
          {se.history}
          {history.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 text-primary text-[10px] px-1.5 py-0.5 font-medium">
              {history.length}
            </span>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* ── Left column ───────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Drop zone */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div
              className={cn(
                'relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed transition-all duration-200',
                isDragging
                  ? 'border-primary bg-primary/10 scale-[1.01]'
                  : droppedFile
                  ? 'border-green-500/50 bg-green-500/5'
                  : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50'
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !droppedFile && fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && !droppedFile && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,audio/*,.mkv,.mp4,.mp3,.wav,.flac,.aac"
                className="sr-only"
                onChange={handleFileChange}
              />
              {droppedFile ? (
                <div className="flex flex-col items-center gap-2 text-center px-4">
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                  <p className="font-medium text-foreground">{droppedFile.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(droppedFile.size)}</p>
                  <button
                    className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                    onClick={(e) => { e.stopPropagation(); handleClearFile(); }}
                  >
                    <X className="h-3 w-3" /> Remove
                  </button>
                </div>
              ) : (
                <>
                  <div className={cn('flex h-14 w-14 items-center justify-center rounded-full transition-colors', isDragging ? 'bg-primary/20' : 'bg-muted')}>
                    {isDragging
                      ? <FileAudio className="h-7 w-7 text-primary animate-bounce" />
                      : <UploadCloud className="h-7 w-7 text-muted-foreground" />}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">{se.dropzone}</p>
                    <p className="text-xs text-muted-foreground mt-1">{se.dropzoneHint}</p>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Segmentation Rules */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-primary inline-block" />
              {se.segmentationRules}
            </h2>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">{se.maxCharsPerLine}</Label>
                <span className="tabular-nums text-sm font-semibold text-primary">{maxChars}</span>
              </div>
              <Slider min={20} max={80} step={1} value={[maxChars]} onValueChange={([v]) => setMaxChars(v)} />
              <div className="flex justify-between text-xs text-muted-foreground"><span>20</span><span>80</span></div>
            </div>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">{se.maxWordsPerLine}</Label>
                <span className="tabular-nums text-sm font-semibold text-primary">{maxWords}</span>
              </div>
              <Slider min={5} max={25} step={1} value={[maxWords]} onValueChange={([v]) => setMaxWords(v)} />
              <div className="flex justify-between text-xs text-muted-foreground"><span>5</span><span>25</span></div>
            </div>
            <Separator />
            <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/50 transition-colors">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                checked={breakAtPunct}
                onChange={(e) => setBreakAtPunct(e.target.checked)}
              />
              <span className="text-sm text-muted-foreground leading-snug">{se.breakAtPunctuation}</span>
            </label>
          </section>
        </div>

        {/* ── Right column ──────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Model Manager */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-primary inline-block" />
              {se.modelSelector}
            </h2>

            <Select value={selectedModelId} onValueChange={setSelectedModelId}>
              <SelectTrigger className="w-full h-auto min-h-[44px] py-2">
                <div className="flex flex-col items-start text-left gap-0.5 mr-1 min-w-0">
                  <span className="font-medium text-sm leading-tight">{selectedModel.name}</span>
                  <span className="text-xs text-muted-foreground leading-tight">
                    {selectedModel.sizeLabel} · {locale === 'zh' ? selectedModel.descZh : selectedModel.descEn}
                  </span>
                </div>
              </SelectTrigger>
              <SelectContent>
                {LLM_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="py-2">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{m.name}</span>
                        {m.backend === 'sherpa' && (
                          <span className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20">EN</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {m.sizeLabel} · {locale === 'zh' ? m.descZh : m.descEn}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Model status badge */}
            <div className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-300',
              modelStatus === 'checking' && 'bg-muted/50 text-muted-foreground',
              modelStatus === 'available' && 'bg-green-500/10 border border-green-500/20 text-green-400',
              modelStatus === 'not-found' && 'bg-amber-500/10 border border-amber-500/20 text-amber-400',
            )}>
              {modelStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
              {modelStatus === 'available' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
              {modelStatus === 'not-found' && <AlertCircle className="h-4 w-4 shrink-0" />}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-medium text-xs">
                  {modelStatus === 'checking' && se.modelChecking}
                  {modelStatus === 'available' && se.modelAvailable}
                  {modelStatus === 'not-found' && se.modelNotFound}
                </span>
                {modelStatus === 'available' && (
                  <span className="text-xs opacity-70 flex items-center gap-1">
                    <Cpu className="h-3 w-3" /> {selectedModel.name} ({selectedModel.sizeLabel})
                  </span>
                )}
                {modelStatus === 'not-found' && (
                  <span className="text-xs opacity-70">{selectedModel.sizeLabel}</span>
                )}
              </div>
            </div>

            {/* Model management buttons (only when downloaded) */}
            {modelStatus === 'available' && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 gap-1.5 text-xs h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={handleDeleteModel}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {se.deleteModel}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 gap-1.5 text-xs h-8 text-muted-foreground"
                  onClick={handleOpenModelDir}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {se.openModelDir}
                </Button>
              </div>
            )}

            {/* Download progress */}
            {(isDownloading || downloadState.phase === 'done') && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <Separator />
                {downloadState.cdnSource && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Wifi className="h-3 w-3 text-primary" />
                    <span>{se.downloadingFrom}:</span>
                    <span className="font-medium text-foreground capitalize">
                      {downloadState.cdnSource === 'modelscope' ? 'ModelScope' : 'HuggingFace'}
                    </span>
                    {downloadState.speedBps > 0 && (
                      <span className="ml-auto tabular-nums text-primary">
                        {formatSpeed(downloadState.speedBps)}
                      </span>
                    )}
                  </div>
                )}
                {downloadState.phase === 'speed-testing' && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span>{se.downloadSpeedTesting}</span>
                  </div>
                )}
                <Progress value={downloadState.percentage} className="h-2" />
                <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                  <span>{formatBytes(downloadState.downloadedBytes)}</span>
                  <span className="font-semibold text-primary">{Math.round(downloadState.percentage)}%</span>
                  <span>{formatBytes(downloadState.totalBytes)}</span>
                </div>
                {downloadState.phase === 'done' && (
                  <div className="flex items-center gap-2 text-xs text-green-400">
                    <Package className="h-3.5 w-3.5" />
                    {se.downloadComplete}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Action Panel */}
          <section className="rounded-xl border border-border bg-card p-5">
            {renderActionButton()}
          </section>

          {/* ASR progress (during extraction) */}
          {extractionStatus === 'extracting' && asrProgress && (
            <section className="rounded-xl border border-border bg-card p-4 space-y-2 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <span className="text-foreground font-medium truncate">{asrProgress.message}</span>
              </div>
              {asrProgress.phase === 'transcribing' && (
                <Progress value={asrProgress.progress * 100} className="h-1.5" />
              )}
            </section>
          )}

          {/* Cancelled notice */}
          {extractionStatus === 'cancelled' && (
            <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-sm text-amber-400">
                <X className="h-4 w-4 shrink-0" />
                <span>转录已取消</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                onClick={clearTask}
              >
                重新提取
              </Button>
            </section>
          )}

          {/* Error display */}
          {extractionStatus === 'error' && asrError && (
            <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 animate-in fade-in duration-200">
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <p className="whitespace-pre-wrap break-words leading-relaxed">{asrError}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => { clearTask(); }}
              >
                重试
              </Button>
            </section>
          )}
        </div>
      </div>

      {/* ── Full-width subtitle preview (shown after successful extraction) ── */}
      {extractionStatus === 'done' && srtSegments.length > 0 && (
        <section className="rounded-xl border border-border bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-green-500 inline-block" />
              {se.resultPreview}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ({srtSegments.length} 条)
              </span>
            </h2>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={handleExportSrt}>
              <Download className="h-3 w-3" />
              {se.exportSrtFile}
            </Button>
          </div>

          {/* Subtitle list */}
          <div
            ref={segListRef}
            className="max-h-[420px] overflow-y-auto divide-y divide-border/40"
          >
            {srtSegments.map((seg, idx) => {
              const isActive = idx === activeSegIdx;
              const durationMs = seg.end_ms - seg.start_ms;
              return (
                <div
                  key={seg.index}
                  data-seg-idx={idx}
                  className={cn(
                    'px-5 py-3 cursor-pointer transition-colors duration-150 border-l-2',
                    isActive
                      ? 'bg-primary/10 border-primary'
                      : 'hover:bg-muted/40 border-transparent'
                  )}
                  onClick={() => seekToSegment(seg)}
                >
                  {/* Timecode row */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums w-5 text-right">
                      {seg.index}
                    </span>
                    <span className={cn('text-[11px] font-mono tabular-nums', isActive ? 'text-primary font-semibold' : 'text-muted-foreground')}>
                      {msToTimecode(seg.start_ms)}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40">→</span>
                    <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                      {msToTimecode(seg.end_ms)}
                    </span>
                    <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60 bg-muted/60 rounded px-1.5 py-0.5">
                      {(durationMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                  {/* Text */}
                  <p className={cn(
                    'text-sm leading-relaxed ml-7',
                    isActive ? 'text-foreground font-medium' : 'text-muted-foreground'
                  )}>
                    {seg.text}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Audio player bar */}
          {resolvedAudioSrc && (
            <div className="border-t border-border/60 px-5 py-3 bg-muted/20">
              <audio
                ref={audioRef}
                src={resolvedAudioSrc}
                onPlay={() => setAudioPlaying(true)}
                onPause={() => setAudioPlaying(false)}
                onTimeUpdate={(e) =>
                  setAudioCurrentMs(Math.floor(e.currentTarget.currentTime * 1000))
                }
                onLoadedMetadata={(e) =>
                  setAudioDurationMs(Math.floor(e.currentTarget.duration * 1000))
                }
                className="hidden"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={togglePlay}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/80 transition-colors"
                >
                  {audioPlaying
                    ? <Pause className="h-3.5 w-3.5" />
                    : <Play className="h-3.5 w-3.5 translate-x-0.5" />}
                </button>
                <span className="text-xs font-mono tabular-nums text-muted-foreground min-w-[80px]">
                  {msToPlayerTime(audioCurrentMs)} / {msToPlayerTime(audioDurationMs)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={audioDurationMs || 1}
                  value={audioCurrentMs}
                  step={100}
                  className="flex-1 h-1.5 accent-primary cursor-pointer"
                  onChange={(e) => {
                    const ms = Number(e.target.value);
                    setAudioCurrentMs(ms);
                    if (audioRef.current) audioRef.current.currentTime = ms / 1000;
                  }}
                />
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}