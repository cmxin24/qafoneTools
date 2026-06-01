import { useState, useRef, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
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
  Music2,
  UploadCloud,
  FileVideo,
  FolderOpen,
  CheckCircle2,
  Loader2,
  X,
  AlertCircle,
  Wifi,
  Package,
  Play,
  Pause,
  Download,
  Volume2,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AudioTrackInfo {
  index: number;
  codec: string;
  channels: number;
  channel_layout: string;
  sample_rate: number;
  bit_rate_kbps: number;
  language: string;
  title: string;
  duration_secs: number;
}

interface DroppedFile {
  name: string;
  size: number;
  path?: string;
}

interface FfmpegDownloadPayload {
  downloaded: number;
  total: number;
  percentage: number;
  speed_bps: number;
  cdn_source: string;
}

interface AudioExtractProgressPayload {
  phase: string;
  progress_pct: number;
  message: string;
}

type FfmpegStatus = 'checking' | 'available' | 'not-found';
type ExtractPhase = 'idle' | 'loading-tracks' | 'extracting' | 'done' | 'error';

interface DownloadState {
  phase: 'idle' | 'speed-testing' | 'downloading' | 'done';
  percentage: number;
  speedBps: number;
  cdnSource: string;
  downloadedBytes: number;
  totalBytes: number;
}

const OUTPUT_FORMATS = [
  { value: 'mp3',  label: 'MP3',       ext: 'mp3',  hasBitrate: true },
  { value: 'aac',  label: 'AAC / M4A', ext: 'm4a',  hasBitrate: true },
  { value: 'flac', label: 'FLAC (无损)', ext: 'flac', hasBitrate: false },
  { value: 'wav',  label: 'WAV (无损)',  ext: 'wav',  hasBitrate: false },
] as const;

const BITRATE_OPTIONS = [128, 192, 256, 320] as const;

const INITIAL_DOWNLOAD: DownloadState = {
  phase: 'idle',
  percentage: 0,
  speedBps: 0,
  cdnSource: '',
  downloadedBytes: 0,
  totalBytes: 0,
};

// ─── Utilities ─────────────────────────────────────────────────────────────────

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Build a nice display string for an audio track */
function trackLabel(track: AudioTrackInfo, index: number): string {
  const lang = track.language ? `[${track.language}]` : '';
  const title = track.title ? ` · ${track.title}` : '';
  return `音轨 ${index + 1}${lang ? ' ' + lang : ''}${title}`;
}

function defaultOutputPath(inputPath: string, ext: string): string {
  const normalized = inputPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const filename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '';
  const lastDot = filename.lastIndexOf('.');
  const base = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  return `${dir}${base}_audio.${ext}`;
}

// ─── Tauri bridges ─────────────────────────────────────────────────────────────

async function tauriCheckFfmpegStatus(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('check_ffmpeg_status');
}

async function tauriDownloadFfmpeg(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('download_ffmpeg');
}

async function tauriGetAudioTracks(inputPath: string): Promise<AudioTrackInfo[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<AudioTrackInfo[]>('get_audio_tracks', { inputPath });
}

async function tauriPreviewAudioTrack(inputPath: string, audioIndex: number, startSecs: number): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('preview_audio_track', { inputPath, audioIndex, startSecs });
}

async function tauriExtractAudioTrack(
  inputPath: string,
  audioIndex: number,
  outputPath: string,
  format: string,
  bitRateKbps: number,
  durationSecs: number,
): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('extract_audio_track', { inputPath, audioIndex, outputPath, format, bitRateKbps, durationSecs });
}

async function tauriOpenPath(path: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_path', { path });
}

async function tauriGetFileSize(path: string): Promise<number> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<number>('get_file_size', { path });
}

async function pickVideoFile(): Promise<{ path: string; name: string } | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: false,
    filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'ts', 'wmv', 'm4v', 'webm', 'flv'] }],
  });
  if (typeof result === 'string' && result) {
    const name = result.replace(/\\/g, '/').split('/').pop() ?? result;
    return { path: result, name };
  }
  return null;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AudioExtractionPage() {
  const { t } = useI18n();
  const ae = t.audioExtraction;
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);

  // ── File state ──────────────────────────────────────────────────────────────
  const [droppedFile, setDroppedFile] = useState<DroppedFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── FFmpeg state ────────────────────────────────────────────────────────────
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus>('checking');
  const [ffmpegDownload, setFfmpegDownload] = useState<DownloadState>(INITIAL_DOWNLOAD);

  // ── Audio tracks ────────────────────────────────────────────────────────────
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<number>(0);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);

  // ── Preview state ───────────────────────────────────────────────────────────
  const [previewingIndex, setPreviewingIndex] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  // Timeline: position (seconds) the user has chosen within the full track duration
  const [previewSeekSecs, setPreviewSeekSecs] = useState(0);
  // Playback position within the current 30s clip
  const [previewCurrentSecs, setPreviewCurrentSecs] = useState(0);
  const [previewClipDuration, setPreviewClipDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  // ── Output settings ─────────────────────────────────────────────────────────
  const [outputFormat, setOutputFormat] = useState<string>('mp3');
  const [bitRateKbps, setBitRateKbps] = useState<number>(320);
  const [customOutputPath, setCustomOutputPath] = useState<string>('');

  // ── Extraction state ────────────────────────────────────────────────────────
  const [extractPhase, setExtractPhase] = useState<ExtractPhase>('idle');
  const [extractProgress, setExtractProgress] = useState(0);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const formatMeta = OUTPUT_FORMATS.find((f) => f.value === outputFormat) ?? OUTPUT_FORMATS[0];
  const isDownloading = ffmpegDownload.phase === 'speed-testing' || ffmpegDownload.phase === 'downloading';
  const canExtract = !!droppedFile && ffmpegStatus === 'available' && audioTracks.length > 0 && extractPhase !== 'extracting';

  // ── Auto-compute default output path ──────────────────────────────────────
  useEffect(() => {
    if (!droppedFile?.path) { setCustomOutputPath(''); return; }
    setCustomOutputPath(defaultOutputPath(droppedFile.path, formatMeta.ext));
  }, [droppedFile?.path]);

  // ── Startup: check FFmpeg ───────────────────────────────────────────────────
  useEffect(() => {
    tauriCheckFfmpegStatus().then((found) => {
      setFfmpegStatus(found ? 'available' : 'not-found');
    });
  }, []);

  // ── Load audio tracks when file changes ────────────────────────────────────
  useEffect(() => {
    if (!droppedFile?.path || ffmpegStatus !== 'available') {
      setAudioTracks([]);
      return;
    }
    setTracksLoading(true);
    setTracksError(null);
    setAudioTracks([]);
    setSelectedTrack(0);
    setPreviewUrl(null);
    setPreviewingIndex(null);

    tauriGetAudioTracks(droppedFile.path).then((tracks) => {
      setAudioTracks(tracks);
      setTracksLoading(false);
    }).catch((err) => {
      setTracksError(String(err));
      setTracksLoading(false);
    });
  }, [droppedFile?.path, ffmpegStatus]);

  // ── Tauri native drag-drop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      unlisten = await getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (locationRef.current !== '/tools/audio-extraction') return;
        const { type } = event.payload;
        if (type === 'enter' || type === 'over') {
          setIsDragging(true);
        } else if (type === 'leave') {
          setIsDragging(false);
        } else if (type === 'drop' && 'paths' in event.payload) {
          setIsDragging(false);
          const path = event.payload.paths[0];
          if (path) {
            const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
            resetForNewFile({ name, size: 0, path });
            import('@tauri-apps/api/core').then(({ invoke }) => {
              invoke<number>('get_file_size', { path }).then((sz) => {
                setDroppedFile((prev) => prev?.path === path ? { ...prev, size: sz } : prev);
              }).catch(() => {});
            });
          }
        }
      });
    })();
    return () => { unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Listen to FFmpeg download progress ─────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<FfmpegDownloadPayload>('ffmpeg-download-progress', (event) => {
        const p = event.payload;
        setFfmpegDownload({
          phase: p.percentage >= 100 ? 'done' : 'downloading',
          percentage: Math.min(p.percentage, 100),
          speedBps: p.speed_bps,
          cdnSource: p.cdn_source,
          downloadedBytes: p.downloaded,
          totalBytes: p.total,
        });
        if (p.percentage >= 100) {
          setTimeout(() => setFfmpegStatus('available'), 600);
        }
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  // ── Listen to extraction progress ──────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<AudioExtractProgressPayload>('audio-extract-progress', (event) => {
        const p = event.payload;
        setExtractProgress(p.progress_pct);
        if (p.phase === 'done') {
          setExtractPhase('done');
        }
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  // ── Audio element event listeners ──────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay  = () => setPreviewPlaying(true);
    const onPause = () => setPreviewPlaying(false);
    const onEnded = () => setPreviewPlaying(false);
    const onTimeUpdate = () => setPreviewCurrentSecs(audio.currentTime);
    const onLoaded = () => {
      setPreviewClipDuration(audio.duration || 0);
      setPreviewCurrentSecs(0);
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoaded);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoaded);
    };
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function resetForNewFile(file: DroppedFile) {
    setDroppedFile(file);
    setAudioTracks([]);
    setSelectedTrack(0);
    setPreviewUrl(null);
    setPreviewingIndex(null);
    setPreviewPlaying(false);
    setPreviewSeekSecs(0);
    setPreviewCurrentSecs(0);
    setPreviewClipDuration(0);
    setExtractPhase('idle');
    setExtractProgress(0);
    setExtractError(null);
    setOutputPath(null);
    audioRef.current?.pause();
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleDownloadFfmpeg = useCallback(async () => {
    setFfmpegDownload({ ...INITIAL_DOWNLOAD, phase: 'speed-testing' });
    if (isTauri()) {
      try { await tauriDownloadFfmpeg(); }
      catch { setFfmpegDownload(INITIAL_DOWNLOAD); }
    } else {
      // Browser dev mock
      await new Promise((r) => setTimeout(r, 1000));
      setFfmpegDownload((p) => ({ ...p, phase: 'downloading', cdnSource: 'evermeet' }));
      const STEPS = 40;
      for (let i = 1; i <= STEPS; i++) {
        await new Promise((r) => setTimeout(r, 80));
        const pct = (i / STEPS) * 100;
        setFfmpegDownload({ phase: i === STEPS ? 'done' : 'downloading', percentage: pct, speedBps: 6_000_000, cdnSource: 'evermeet', downloadedBytes: Math.round(pct / 100 * 70_000_000), totalBytes: 70_000_000 });
      }
      setTimeout(() => setFfmpegStatus('available'), 600);
    }
  }, []);

  const handleBrowse = useCallback(async () => {
    if (droppedFile) return;
    if (isTauri()) {
      const picked = await pickVideoFile();
      if (picked) {
        resetForNewFile({ name: picked.name, size: 0, path: picked.path });
        tauriGetFileSize(picked.path).then((sz) => {
          setDroppedFile((prev) => prev?.path === picked.path ? { ...prev, size: sz } : prev);
        }).catch(() => {});
      }
    } else {
      fileInputRef.current?.click();
    }
  }, [droppedFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) resetForNewFile({ name: file.name, size: file.size });
  }, []);

  const handleClearFile = useCallback(() => {
    resetForNewFile({ name: '', size: 0 });
    setDroppedFile(null);
    audioRef.current?.pause();
  }, []);

  const handleDragOver  = useCallback((e: React.DragEvent) => { if (isTauri()) return; e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback(() => { if (isTauri()) return; setIsDragging(false); }, []);
  const handleDrop      = useCallback((e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) resetForNewFile({ name: file.name, size: file.size });
  }, []);

  const handleSelectOutputPath = useCallback(async () => {
    if (!isTauri()) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === 'string' && dir) {
      const normalized = dir.replace(/\\/g, '/');
      const currentFilename = customOutputPath.replace(/\\/g, '/').split('/').pop() ?? '';
      const fallbackName = droppedFile?.path
        ? defaultOutputPath(droppedFile.path, formatMeta.ext).split('/').pop() ?? ''
        : '';
      const filename = currentFilename || fallbackName;
      setCustomOutputPath(filename ? `${normalized}/${filename}` : normalized);
    }
  }, [customOutputPath, droppedFile, formatMeta.ext]);

  const handlePreview = useCallback(async (trackIndex: number, startSecs = 0) => {
    if (!droppedFile?.path) return;
    audioRef.current?.pause();

    // Toggle off if same track AND same position
    if (previewingIndex === trackIndex && startSecs === previewSeekSecs && previewUrl !== null) {
      setPreviewingIndex(null);
      setPreviewUrl(null);
      setPreviewSeekSecs(0);
      return;
    }

    setPreviewingIndex(trackIndex);
    setPreviewLoading(true);
    setPreviewUrl(null);
    setPreviewCurrentSecs(0);
    setPreviewClipDuration(0);

    if (isTauri()) {
      try {
        const filePath = await tauriPreviewAudioTrack(droppedFile.path, trackIndex, startSecs);
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const url = convertFileSrc(filePath);
        setPreviewUrl(url);
        setPreviewLoading(false);
        // Auto-play after a short delay to let the element load
        setTimeout(() => { audioRef.current?.play().catch(() => {}); }, 100);
      } catch (err) {
        setPreviewLoading(false);
        setPreviewingIndex(null);
        console.error('Preview failed:', err);
      }
    } else {
      // Browser dev mock
      await new Promise((r) => setTimeout(r, 600));
      setPreviewUrl('');
      setPreviewLoading(false);
    }
  }, [droppedFile?.path, previewingIndex, previewSeekSecs, previewUrl]);

  const handleTogglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewPlaying) { audio.pause(); } else { audio.play().catch(() => {}); }
  }, [previewPlaying]);

  const handleExtract = useCallback(async () => {
    if (!droppedFile?.path || !canExtract) return;

    const track = audioTracks[selectedTrack];
    if (!track) return;

    const outPath = customOutputPath || defaultOutputPath(droppedFile.path, formatMeta.ext);

    setExtractPhase('extracting');
    setExtractProgress(0);
    setExtractError(null);
    setOutputPath(null);

    if (isTauri()) {
      try {
        await tauriExtractAudioTrack(
          droppedFile.path,
          selectedTrack,
          outPath,
          outputFormat,
          bitRateKbps,
          track.duration_secs,
        );
        setOutputPath(outPath);
        setExtractPhase('done');
      } catch (err) {
        setExtractError(String(err));
        setExtractPhase('error');
      }
    } else {
      // Browser dev mock
      const STEPS = 30;
      for (let i = 1; i <= STEPS; i++) {
        await new Promise((r) => setTimeout(r, 100));
        setExtractProgress((i / STEPS) * 100);
      }
      setOutputPath(outPath);
      setExtractPhase('done');
    }
  }, [droppedFile, canExtract, audioTracks, selectedTrack, customOutputPath, formatMeta.ext, outputFormat, bitRateKbps]);

  const handleOpenOutput = useCallback(async () => {
    if (outputPath) await tauriOpenPath(outputPath);
  }, [outputPath]);

  const handleOpenOutputFolder = useCallback(async () => {
    if (!outputPath) return;
    const dir = outputPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    if (dir) await tauriOpenPath(dir);
  }, [outputPath]);

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Hidden file input for browser fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,.mkv,.mov,.avi,.ts,.wmv,.m4v,.webm,.flv"
        className="hidden"
        onChange={handleFileChange}
      />
      {/* Hidden audio element for previewing tracks */}
      <audio ref={audioRef} src={previewUrl ?? undefined} />

      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
          <Music2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">{ae.title}</h1>
          <p className="text-sm text-muted-foreground">{ae.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Left column ─────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Drop zone */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div
              className={cn(
                'relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed transition-all duration-200',
                isDragging
                  ? 'border-primary bg-primary/10 scale-[1.01]'
                  : droppedFile
                  ? 'border-green-500/50 bg-green-500/5'
                  : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50'
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !droppedFile && handleBrowse()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !droppedFile) handleBrowse(); }}
            >
              {droppedFile ? (
                <div className="flex w-full items-center gap-3 px-4">
                  <FileVideo className="h-9 w-9 shrink-0 text-green-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{droppedFile.name}</p>
                    {droppedFile.size > 0 && (
                      <p className="text-xs text-muted-foreground">{formatBytes(droppedFile.size)}</p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); handleClearFile(); }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <UploadCloud className={cn('h-10 w-10 transition-colors', isDragging ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">{ae.dropzone}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{ae.dropzoneHint}</p>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* FFmpeg Status */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">{ae.ffmpegManager}</h2>
            {ffmpegStatus === 'checking' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {ae.ffmpegChecking}
              </div>
            )}
            {ffmpegStatus === 'available' && (
              <div className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                {ae.ffmpegAvailable}
              </div>
            )}
            {ffmpegStatus === 'not-found' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-amber-400">
                  <Package className="h-4 w-4" />
                  {ae.ffmpegNotFound}
                </div>
                {isDownloading ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      {ffmpegDownload.phase === 'speed-testing'
                        ? <span className="flex items-center gap-1"><Wifi className="h-3.5 w-3.5" />{ae.ffmpegDownloadSpeedTesting}</span>
                        : <span>{ae.ffmpegDownloadingFrom} <span className="text-foreground font-medium">{ffmpegDownload.cdnSource}</span></span>}
                      <span>{formatSpeed(ffmpegDownload.speedBps)}</span>
                    </div>
                    <Progress value={ffmpegDownload.percentage} className="h-1.5" />
                    <p className="text-right text-xs text-muted-foreground">
                      {formatBytes(ffmpegDownload.downloadedBytes)} / {formatBytes(ffmpegDownload.totalBytes)}
                    </p>
                  </div>
                ) : (
                  <Button size="sm" className="gap-2 w-full" onClick={handleDownloadFfmpeg}>
                    <Download className="h-3.5 w-3.5" />
                    {ae.downloadFfmpeg}
                  </Button>
                )}
              </div>
            )}
          </section>

          {/* Audio Tracks */}
          {(droppedFile && ffmpegStatus === 'available') && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">{ae.audioTracks}</h2>

              {tracksLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在读取音轨信息…
                </div>
              )}

              {tracksError && (
                <div className="flex items-center gap-2 text-sm text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  {tracksError}
                </div>
              )}

              {!tracksLoading && !tracksError && audioTracks.length === 0 && (
                <p className="text-sm text-muted-foreground">{ae.noTracksFound}</p>
              )}

              {!tracksLoading && audioTracks.length > 0 && (
                <div className="space-y-2">
                  {audioTracks.map((track, idx) => {
                    const isSelected = selectedTrack === idx;
                    const isPreviewing = previewingIndex === idx;
                    return (
                      <div key={idx} className="rounded-lg border transition-all"
                        style={{ borderColor: isSelected ? 'hsl(var(--primary))' : undefined }}
                      >
                        {/* Track row */}
                        <div
                          onClick={() => setSelectedTrack(idx)}
                          className={cn(
                            'group flex cursor-pointer items-center gap-3 p-3 transition-all rounded-lg',
                            isSelected
                              ? 'bg-primary/8'
                              : 'hover:bg-muted/40'
                          )}
                        >
                        {/* Selection indicator */}
                        <div className={cn(
                          'h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-all',
                          isSelected ? 'border-primary' : 'border-muted-foreground/40'
                        )}>
                          {isSelected && <div className="h-2 w-2 rounded-full bg-primary" />}
                        </div>

                        {/* Track info */}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {trackLabel(track, idx)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {track.codec.toUpperCase()}
                            {track.channel_layout && ` · ${track.channel_layout}`}
                            {track.sample_rate > 0 && ` · ${(track.sample_rate / 1000).toFixed(1)} kHz`}
                            {track.bit_rate_kbps > 0 && ` · ${track.bit_rate_kbps} kbps`}
                            {track.duration_secs > 0 && ` · ${formatDuration(track.duration_secs)}`}
                          </p>
                        </div>

                        {/* Preview controls */}
                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {isPreviewing && previewUrl !== null && !previewLoading && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={handleTogglePlay}
                              title={previewPlaying ? '暂停' : '播放'}
                            >
                              {previewPlaying
                                ? <Pause className="h-3.5 w-3.5" />
                                : <Play className="h-3.5 w-3.5" />}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={isPreviewing ? 'default' : 'outline'}
                            className="h-7 px-2 gap-1.5 text-xs"
                            onClick={() => handlePreview(idx, previewingIndex === idx ? previewSeekSecs : 0)}
                            disabled={previewLoading && previewingIndex !== idx}
                          >
                            {previewLoading && previewingIndex === idx
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Volume2 className="h-3 w-3" />}
                            {ae.previewTrack}
                          </Button>
                        </div>
                        </div>

                      {/* Expanded preview panel: timeline scrubber + playback */}
                      {isPreviewing && (
                        <div
                          className="mt-2 space-y-2 rounded-lg bg-muted/40 p-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Full track position slider */}
                          {track.duration_secs > 0 && (
                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px] text-muted-foreground">
                                <span>定位到</span>
                                <span>{formatDuration(previewingIndex === idx ? previewSeekSecs : 0)} / {formatDuration(track.duration_secs)}</span>
                              </div>
                              <Slider
                                min={0}
                                max={Math.floor(track.duration_secs)}
                                step={5}
                                value={[previewingIndex === idx ? previewSeekSecs : 0]}
                                onValueChange={([v]) => setPreviewSeekSecs(v)}
                                onValueCommit={([v]) => {
                                  setPreviewSeekSecs(v);
                                  handlePreview(idx, v);
                                }}
                                className="h-4"
                              />
                            </div>
                          )}

                          {/* Clip playback progress */}
                          {previewUrl !== null && !previewLoading && (
                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px] text-muted-foreground">
                                <span>片段进度</span>
                                <span>{formatDuration(previewCurrentSecs)} / {formatDuration(previewClipDuration || 30)}</span>
                              </div>
                              <Slider
                                min={0}
                                max={previewClipDuration || 30}
                                step={0.5}
                                value={[previewCurrentSecs]}
                                onValueChange={([v]) => {
                                  if (audioRef.current) {
                                    audioRef.current.currentTime = v;
                                    setPreviewCurrentSecs(v);
                                  }
                                }}
                                className="h-4"
                              />
                            </div>
                          )}

                          {/* Loading indicator */}
                          {previewLoading && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              正在提取预览片段…
                            </div>
                          )}
                        </div>
                      )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>

        {/* ── Right column ────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Output Settings */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold text-foreground">{ae.outputSettings}</h2>
            <div className="space-y-4">
              {/* Format */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{ae.outputFormat}</Label>
                <Select value={outputFormat} onValueChange={setOutputFormat}>
                  <SelectTrigger className="h-9 text-sm">
                    <span>{formatMeta.label}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {OUTPUT_FORMATS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Bitrate (only for mp3 / aac) */}
              {formatMeta.hasBitrate && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{ae.bitRate}</Label>
                  <Select value={String(bitRateKbps)} onValueChange={(v) => setBitRateKbps(Number(v))}>
                    <SelectTrigger className="h-9 text-sm">
                      <span>{bitRateKbps} kbps</span>
                    </SelectTrigger>
                    <SelectContent>
                      {BITRATE_OPTIONS.map((br) => (
                        <SelectItem key={br} value={String(br)}>{br} kbps</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Separator />

              {/* Output path */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <FolderOpen className="h-3.5 w-3.5" />
                  {ae.outputPath}
                </Label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={customOutputPath}
                    onChange={(e) => setCustomOutputPath(e.target.value)}
                    placeholder=""
                    className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {isTauri() && (
                    <button
                      type="button"
                      title={ae.selectOutputPath}
                      disabled={!droppedFile}
                      className="flex items-center justify-center rounded-md border border-border bg-muted/50 px-2 hover:bg-muted transition-colors disabled:opacity-40"
                      onClick={handleSelectOutputPath}
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>

              </div>
            </div>
          </section>

          {/* Action / Progress */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-3">
            {/* Extract progress */}
            {(extractPhase === 'extracting') && (
              <div className="space-y-1.5 animate-in fade-in">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{ae.extracting}</span>
                  <span>{Math.round(extractProgress)}%</span>
                </div>
                <Progress value={extractProgress} className="h-1.5" />
              </div>
            )}

            {/* Error */}
            {extractPhase === 'error' && extractError && (
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 animate-in fade-in">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-400 break-all">{extractError}</p>
              </div>
            )}

            {/* Done */}
            {extractPhase === 'done' && (
              <div className="space-y-2 animate-in fade-in">
                <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  <p className="text-sm font-medium text-green-400">{ae.extractComplete}</p>
                </div>
                <Button className="w-full gap-2" size="sm" variant="outline" onClick={handleOpenOutput}>
                  <Music2 className="h-3.5 w-3.5" />
                  {ae.openOutput}
                </Button>
                <Button className="w-full gap-2" size="sm" variant="ghost" onClick={handleOpenOutputFolder}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  {ae.openOutputFolder}
                </Button>
              </div>
            )}

            {/* Extract button */}
            {(extractPhase === 'idle' || extractPhase === 'error') && (
              <Button
                className="w-full gap-2"
                size="lg"
                disabled={!canExtract}
                onClick={handleExtract}
              >
                <Music2 className="h-4 w-4" />
                {ae.startExtract}
              </Button>
            )}

            {extractPhase === 'extracting' && (
              <Button className="w-full gap-2" size="lg" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                {ae.extracting}
              </Button>
            )}

            {extractPhase === 'done' && (
              <Button
                className="w-full gap-2"
                size="sm"
                variant="ghost"
                onClick={() => { setExtractPhase('idle'); setExtractProgress(0); setOutputPath(null); }}
              >
                <Music2 className="h-3.5 w-3.5" />
                重新提取
              </Button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
