import { useState, useRef, useCallback, useEffect } from 'react';
import { useI18n } from '@/i18n';
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
import { cn } from '@/lib/utils';
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
} from 'lucide-react';

// ─── Whisper model catalogue ─────────────────────────────────────────────────
interface WhisperModelMeta {
  id: string;
  name: string;
  /** Human-readable file size shown on the download button */
  sizeLabel: string;
  /** Byte size sent to the Tauri command for progress calculation */
  sizeBytes: number;
  /** Description shown in the dropdown (English) */
  descEn: string;
  /** Description shown in the dropdown (Chinese) */
  descZh: string;
}

const WHISPER_MODELS: WhisperModelMeta[] = [
  {
    id: 'tiny',
    name: 'Whisper Tiny',
    sizeLabel: '75 MB',
    sizeBytes: 75_571_688,
    descEn: 'Fastest · lowest accuracy',
    descZh: '最快 · 精度最低',
  },
  {
    id: 'base',
    name: 'Whisper Base',
    sizeLabel: '145 MB',
    sizeBytes: 147_964_211,
    descEn: 'Fast · decent accuracy',
    descZh: '较快 · 精度一般',
  },
  {
    id: 'medium',
    name: 'Whisper Medium',
    sizeLabel: '1.5 GB',
    sizeBytes: 1_533_763_059,
    descEn: 'Balanced · good accuracy',
    descZh: '均衡 · 精度良好',
  },
  {
    id: 'large-v3-turbo',
    name: 'Whisper Large V3 Turbo',
    sizeLabel: '809 MB',
    sizeBytes: 874_188_912,
    descEn: 'Recommended · near-best accuracy',
    descZh: '推荐 · 精度接近最佳',
  },
];

// ─── Tauri bridge (gracefully degrades in browser dev mode) ──────────────────
/** Returns true when running inside a Tauri desktop window. */
const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Payload emitted by the `model-download-progress` Tauri event. */
interface DownloadProgressPayload {
  model_id: string;
  downloaded: number;
  total: number;
  percentage: number;
  speed_bps: number;
  cdn_source: string; // "huggingface" | "modelscope"
}

/** Check whether a Whisper model binary exists in the app's data directory. */
async function tauriCheckModelStatus(modelId: string): Promise<boolean> {
  if (!isTauri()) return false; // browser dev: always treat as not found
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('check_model_status', { modelId });
}

/** Trigger model download via Tauri command (progress arrives via events). */
async function tauriDownloadModel(modelId: string, totalSize: number): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('download_model', { modelId, totalSize });
}

// ─── Helper ──────────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

// ─── Component types ─────────────────────────────────────────────────────────
type ModelStatus = 'checking' | 'available' | 'not-found';
type ExtractionStatus = 'idle' | 'extracting' | 'done';

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
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function SubtitleExtractionPage() {
  const { t, locale } = useI18n();
  const se = t.subtitleExtraction;

  // File state
  const [droppedFile, setDroppedFile] = useState<DroppedFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Model selection & status
  const [selectedModelId, setSelectedModelId] = useState('large-v3-turbo');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('checking');

  // Download state
  const [downloadState, setDownloadState] = useState<DownloadState>(INITIAL_DOWNLOAD_STATE);

  // Segmentation config
  const [maxChars, setMaxChars] = useState(45);
  const [maxWords, setMaxWords] = useState(12);
  const [breakAtPunct, setBreakAtPunct] = useState(true);

  // Extraction state
  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>('idle');

  // ── Derived data ────────────────────────────────────────────────────────────
  const selectedModel = WHISPER_MODELS.find((m) => m.id === selectedModelId)!;

  // ── Check model status whenever selection changes ───────────────────────────
  useEffect(() => {
    setModelStatus('checking');
    setDownloadState(INITIAL_DOWNLOAD_STATE);
    setExtractionStatus('idle');

    tauriCheckModelStatus(selectedModelId).then((found) => {
      setModelStatus(found ? 'available' : 'not-found');
    });
  }, [selectedModelId]);

  // ── Subscribe to Tauri download-progress events ─────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<DownloadProgressPayload>(
        'model-download-progress',
        (event) => {
          const p = event.payload;
          // Ignore progress for models other than the currently selected one
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
            // Brief delay so the progress bar visually reaches 100% before transition
            setTimeout(() => setModelStatus('available'), 600);
          }
        }
      );
    })();

    return () => { unlisten?.(); };
  }, [selectedModelId]);

  // ── Download handler ────────────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    setDownloadState({ ...INITIAL_DOWNLOAD_STATE, phase: 'speed-testing' });

    if (isTauri()) {
      // Real Tauri path — progress arrives via events
      try {
        await tauriDownloadModel(selectedModelId, selectedModel.sizeBytes);
      } catch (err) {
        console.error('Download failed:', err);
        setDownloadState(INITIAL_DOWNLOAD_STATE);
      }
    } else {
      // ── Browser dev mock: simulate a download with fake progress ────────────
      await new Promise((r) => setTimeout(r, 1200)); // simulate speed-test delay
      setDownloadState((prev) => ({ ...prev, phase: 'downloading', cdnSource: 'modelscope' }));

      const STEPS = 60;
      for (let i = 1; i <= STEPS; i++) {
        await new Promise((r) => setTimeout(r, 80));
        const pct = (i / STEPS) * 100;
        const downloaded = Math.round((pct / 100) * selectedModel.sizeBytes);
        setDownloadState({
          phase: i === STEPS ? 'done' : 'downloading',
          percentage: pct,
          speedBps: 8_000_000 + Math.random() * 4_000_000, // mock ~8–12 MB/s
          cdnSource: 'modelscope',
          downloadedBytes: downloaded,
          totalBytes: selectedModel.sizeBytes,
        });
      }
      setTimeout(() => setModelStatus('available'), 600);
    }
  }, [selectedModelId, selectedModel]);

  // ── File drag & drop ────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) { setDroppedFile({ name: file.name, size: file.size }); setExtractionStatus('idle'); }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setDroppedFile({ name: file.name, size: file.size }); setExtractionStatus('idle'); }
  }, []);

  const handleClearFile = useCallback(() => {
    setDroppedFile(null);
    setExtractionStatus('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ── Extraction (mock) ───────────────────────────────────────────────────────
  const handleStartExtraction = useCallback(() => {
    if (!droppedFile || modelStatus !== 'available') return;
    setExtractionStatus('extracting');
    setTimeout(() => setExtractionStatus('done'), 2800);
  }, [droppedFile, modelStatus]);

  // ─── Render helpers ────────────────────────────────────────────────────────
  const isDownloading =
    downloadState.phase === 'speed-testing' || downloadState.phase === 'downloading';

  const renderActionButton = () => {
    // Checking
    if (modelStatus === 'checking') {
      return (
        <Button className="w-full gap-2" size="lg" disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
          {se.modelChecking}
        </Button>
      );
    }

    // Model not downloaded → Download button
    if (modelStatus === 'not-found') {
      return (
        <Button
          className="w-full gap-2"
          size="lg"
          variant="outline"
          disabled={isDownloading}
          onClick={handleDownload}
        >
          {isDownloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {isDownloading
            ? downloadState.phase === 'speed-testing'
              ? se.downloadSpeedTesting
              : `${Math.round(downloadState.percentage)}%`
            : `📥 ${se.downloadModel} (${selectedModel.sizeLabel})`}
        </Button>
      );
    }

    // Extraction actions
    if (extractionStatus !== 'done') {
      return (
        <Button
          className="w-full gap-2"
          size="lg"
          disabled={!droppedFile || extractionStatus === 'extracting'}
          onClick={handleStartExtraction}
        >
          {extractionStatus === 'extracting' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {se.extracting}
            </>
          ) : (
            <>
              <Scissors className="h-4 w-4" />
              {se.startExtraction}
            </>
          )}
        </Button>
      );
    }

    return (
      <div className="space-y-2 animate-in fade-in duration-300">
        <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          <p className="text-sm font-medium text-green-400">{se.extractionComplete}</p>
        </div>
        <Button className="w-full gap-2" variant="outline">
          <Download className="h-4 w-4" />
          {se.exportSrt}
        </Button>
        <Button className="w-full gap-2">
          <Send className="h-4 w-4" />
          {se.sendToTranslation}
          <ChevronRight className="h-4 w-4 ml-auto" />
        </Button>
      </div>
    );
  };

  // ─── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
          <Scissors className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">{se.title}</h1>
          <p className="text-sm text-muted-foreground">{se.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* ── Left column ───────────────────────────────────────────── */}
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

        {/* ── Right column ──────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Model Manager */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-primary inline-block" />
              {se.modelSelector}
            </h2>

            {/* Dropdown */}
            <Select value={selectedModelId} onValueChange={setSelectedModelId}>
              {/* 自定义 trigger 内容以展示双行信息，并规避 [&>span]:line-clamp-1 */}
              <SelectTrigger className="w-full h-auto min-h-[44px] py-2">
                <div className="flex flex-col items-start text-left gap-0.5 mr-1 min-w-0">
                  <span className="font-medium text-sm leading-tight">{selectedModel.name}</span>
                  <span className="text-xs text-muted-foreground leading-tight">
                    {selectedModel.sizeLabel} · {locale === 'zh' ? selectedModel.descZh : selectedModel.descEn}
                  </span>
                </div>
              </SelectTrigger>
              <SelectContent>
                {WHISPER_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="py-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{m.name}</span>
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
              <div className="flex flex-col min-w-0">
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

            {/* Download progress section */}
            {(isDownloading || downloadState.phase === 'done') && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <Separator />

                {/* CDN indicator */}
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

                {/* Speed testing indicator */}
                {downloadState.phase === 'speed-testing' && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span>{se.downloadSpeedTesting}</span>
                  </div>
                )}

                {/* Progress bar */}
                <Progress value={downloadState.percentage} className="h-2" />

                {/* Byte count */}
                <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                  <span>{formatBytes(downloadState.downloadedBytes)}</span>
                  <span className="font-semibold text-primary">
                    {Math.round(downloadState.percentage)}%
                  </span>
                  <span>{formatBytes(downloadState.totalBytes)}</span>
                </div>

                {/* Done message */}
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

          {/* Result preview */}
          {extractionStatus === 'done' && (
            <section className="rounded-xl border border-border bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <span className="h-4 w-1 rounded-full bg-green-500 inline-block" />
                {se.resultPreview}
              </h2>
              <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground max-h-48 overflow-auto">
                {se.resultPlaceholder}
              </pre>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
