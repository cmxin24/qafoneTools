import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { cn } from '@/components/ui/utils';
import {
  Film,
  UploadCloud,
  FileVideo,
  Download,
  FolderOpen,
  CheckCircle2,
  Loader2,
  X,
  AlertCircle,
  Wifi,
  Package,
  Gauge,
  FolderInput,
  Pause,
  Play,
  Square,
  Copy,
  Check,
} from 'lucide-react';

// ─── 分辨率预设 ─────────────────────────────────────────────────────────────────
interface ResolutionPreset {
  label: string;
  height: number;
}

const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { label: '360p', height: 360 },
  { label: '480p', height: 480 },
  { label: '540p', height: 540 },   // 默认
  { label: '720p', height: 720 },
];

// ─── Tauri 桥接 ──────────────────────────────────────────────────────────────
const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** FFmpeg 下载进度事件 payload（对应 Rust FfmpegDownloadProgressPayload） */
interface FfmpegDownloadPayload {
  downloaded: number;
  total: number;
  percentage: number;
  speed_bps: number;
  cdn_source: string;
}

/** 视频压制进度事件 payload（对应 Rust VideoCompressProgressPayload） */
interface CompressProgressPayload {
  /** 'preparing' | 'encoding' | 'done' | 'canceled' | 'error' */
  phase: string;
  /** 当前阶段进度百分比 0–100 */
  progress_pct: number;
}

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

async function tauriCompressVideo(
  inputPath: string,
  outputPath: string,
  targetHeight: number,
): Promise<string> {
  if (!isTauri()) return '';
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('compress_video', { inputPath, outputPath, targetHeight });
}

async function tauriPauseVideoCompression(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('pause_video_compression');
}

async function tauriResumeVideoCompression(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('resume_video_compression');
}

async function tauriCancelVideoCompression(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('cancel_video_compression');
}

async function tauriGetVideoResolution(path: string): Promise<VideoResolution> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<VideoResolution>('get_video_resolution', { path });
}

/** 通过 Tauri dialog 打开视频文件选择器，返回文件路径和名称 */
async function pickVideoFile(): Promise<{ path: string; name: string } | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: false,
    filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'ts', 'wmv', 'm4v', 'webm'] }],
  });
  if (typeof result === 'string' && result) {
    const name = result.replace(/\\/g, '/').split('/').pop() ?? result;
    return { path: result, name };
  }
  return null;
}

/** 计算默认输出路径：相同目录，文件名加 _小版本 后缀，固定输出 MP4 */
function defaultOutputPath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const filename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '';
  const lastDot = filename.lastIndexOf('.');
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  return `${dir}${stem}_小版本.mp4`;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

function quoteCliArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function ensureMp4OutputPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';
  const normalized = trimmed.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const filename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '';
  const lastDot = filename.lastIndexOf('.');
  if (lastDot > 0) return `${dir}${filename.slice(0, lastDot)}.mp4`;
  return `${dir}${filename}.mp4`;
}

const X264_OPTS = [
  'ref=4',
  'bframes=3',
  'me=umh',
  'keyint=600',
  'min-keyint=1',
  'deblock=1,1',
  'scenecut=60',
  'qcomp=0.5',
  'psy-rd=0.3,0',
  'aq-mode=2',
  'aq-strength=0.8',
].join(':');

function buildCompactVideoCommand(inputPath: string, outputPath: string, targetHeight: number): string {
  return [
    'ffmpeg',
    '-y',
    '-i', quoteCliArg(inputPath),
    '-progress', 'pipe:2',
    '-nostats',
    '-vf', quoteCliArg(`scale=-2:${targetHeight}`),
    '-c:v', 'libx264',
    '-crf', '22',
    '-profile:v', 'high',
    '-preset', 'slow',
    '-x264opts', quoteCliArg(X264_OPTS),
    '-c:a', 'aac',
    '-b:a', '256k',
    '-ac', '2',
    '-movflags', '+faststart',
    quoteCliArg(outputPath),
  ].join(' ');
}

function estimateScaledResolution(source: VideoResolution, targetHeight: number): VideoResolution {
  const rawWidth = (source.width / source.height) * targetHeight;
  return {
    width: Math.max(2, Math.round(rawWidth / 2) * 2),
    height: targetHeight,
  };
}

function probeBrowserVideoResolution(file: File): Promise<VideoResolution> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to read video metadata'));
    };
    video.src = url;
  });
}

// ─── 组件类型 ─────────────────────────────────────────────────────────────────
type FfmpegStatus = 'checking' | 'available' | 'not-found';

interface DownloadState {
  phase: 'idle' | 'speed-testing' | 'downloading' | 'done';
  percentage: number;
  speedBps: number;
  cdnSource: string;
  downloadedBytes: number;
  totalBytes: number;
}

type CompressPhase = 'idle' | 'preparing' | 'encoding' | 'done' | 'error';

const INITIAL_DOWNLOAD: DownloadState = {
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
  /** 仅在 Tauri 环境下有值，用于传给后端 */
  path?: string;
  /** 仅在浏览器 dev 环境下用于读取视频元数据 */
  file?: File;
}

interface VideoResolution {
  width: number;
  height: number;
}

type VideoResolutionStatus = 'idle' | 'loading' | 'done' | 'unavailable' | 'error';

function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} disabled={!text}>
      {copied ? <Check className="mr-2 h-3.5 w-3.5 text-green-500" /> : <Copy className="mr-2 h-3.5 w-3.5" />}
      {copied ? copiedLabel : label}
    </Button>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────
export default function CompactVideoPage() {
  const { t, locale } = useI18n();
  const cv = t.compactVideo;
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);

  // ── 文件状态 ──────────────────────────────────────────────────────────────
  const [droppedFile, setDroppedFile] = useState<DroppedFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [videoResolution, setVideoResolution] = useState<VideoResolution | null>(null);
  const [videoResolutionStatus, setVideoResolutionStatus] = useState<VideoResolutionStatus>('idle');
  const [videoResolutionError, setVideoResolutionError] = useState<string | null>(null);

  // ── FFmpeg 状态 ───────────────────────────────────────────────────────────
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus>('checking');
  const [ffmpegDownload, setFfmpegDownload] = useState<DownloadState>(INITIAL_DOWNLOAD);

  // ── 输出设置 ──────────────────────────────────────────────────────────────
  const [targetHeight, setTargetHeight] = useState(540);

  // ── 压制状态 ──────────────────────────────────────────────────────────────
  const [compressPhase, setCompressPhase] = useState<CompressPhase>('idle');
  const [compressProgress, setCompressProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [compressError, setCompressError] = useState<string | null>(null);
  const pauseRef = useRef(false);
  const cancelRef = useRef(false);

  // ── 自定义输出路径 ───────────────────────────────────────────
  const [customOutputPath, setCustomOutputPath] = useState('');
  // ── 派生值 ────────────────────────────────────────────────────────────────
  const selectedPreset = RESOLUTION_PRESETS.find((p) => p.height === targetHeight)!;
  const isDownloading =
    ffmpegDownload.phase === 'speed-testing' || ffmpegDownload.phase === 'downloading';
  const isCompressing = compressPhase === 'preparing' || compressPhase === 'encoding';
  const pendingCommand = useMemo(() => {
    if (!droppedFile) return '';
    const inputPath = droppedFile.path ?? droppedFile.name;
    const nextOutputPath = ensureMp4OutputPath(customOutputPath || defaultOutputPath(inputPath));
    return buildCompactVideoCommand(inputPath, nextOutputPath, targetHeight);
  }, [droppedFile, customOutputPath, targetHeight]);
  const estimatedOutputResolution = useMemo(() => {
    if (!videoResolution) return null;
    return estimateScaledResolution(videoResolution, targetHeight);
  }, [videoResolution, targetHeight]);
  const isCompressingRef = useRef(false);
  useEffect(() => { isCompressingRef.current = isCompressing; }, [isCompressing]);

  const prepareResolutionProbe = useCallback(() => {
    setVideoResolution(null);
    setVideoResolutionError(null);
    setVideoResolutionStatus('loading');
  }, []);

  // ── 导入视频后读取当前分辨率 ──────────────────────────────────────────────
  useEffect(() => {
    let canceled = false;

    if (!droppedFile) {
      return;
    }

    if (droppedFile.file) {
      probeBrowserVideoResolution(droppedFile.file)
        .then((res) => {
          if (canceled) return;
          setVideoResolution(res);
          setVideoResolutionStatus('done');
        })
        .catch((err) => {
          if (canceled) return;
          setVideoResolutionError(String(err));
          setVideoResolutionStatus('error');
        });
      return () => { canceled = true; };
    }

    if (!droppedFile.path) {
      window.setTimeout(() => {
        if (!canceled) setVideoResolutionStatus('unavailable');
      }, 0);
      return;
    }

    if (ffmpegStatus === 'checking') {
      return;
    }

    if (ffmpegStatus !== 'available') {
      window.setTimeout(() => {
        if (!canceled) setVideoResolutionStatus('unavailable');
      }, 0);
      return;
    }

    tauriGetVideoResolution(droppedFile.path)
      .then((res) => {
        if (canceled) return;
        setVideoResolution(res);
        setVideoResolutionStatus('done');
      })
      .catch((err) => {
        if (canceled) return;
        setVideoResolutionError(String(err));
        setVideoResolutionStatus('error');
      });

    return () => { canceled = true; };
  }, [droppedFile, ffmpegStatus]);
  // ── 挂载时检测 FFmpeg ──────────────────────────────────────────────────────
  useEffect(() => {
    tauriCheckFfmpegStatus().then((found) => {
      setFfmpegStatus(found ? 'available' : 'not-found');
    });
  }, [prepareResolutionProbe]);
  // ── Tauri 原生拖放事件 ───────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      unlisten = await getCurrentWebviewWindow().onDragDropEvent((event) => {
        // Only handle events when this page is active
        if (locationRef.current !== '/tools/compact-video') return;
        const { type } = event.payload;
        if (type === 'enter' || type === 'over') {
          setIsDragging(true);
        } else if (type === 'leave') {
          setIsDragging(false);
        } else if (type === 'drop' && 'paths' in event.payload) {
          if (isCompressingRef.current) return;
          setIsDragging(false);
          const path = event.payload.paths[0];
          if (path) {
            const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
            prepareResolutionProbe();
            setDroppedFile({ name, size: 0, path });
            setCustomOutputPath(defaultOutputPath(path));
            setCompressPhase('idle');
            setIsPaused(false);
            setIsCanceling(false);
            setOutputPath(null);
            setCompressError(null);
            // Fetch actual file size from Rust
            import('@tauri-apps/api/core').then(({ invoke: tauriInvoke }) => {
              tauriInvoke<number>('get_file_size', { path }).then((sz) => {
                setDroppedFile((prev) => prev?.path === path ? { ...prev, size: sz } : prev);
              }).catch(() => {/* ignore */});
            });
          }
        }
      });
    })();
    return () => { unlisten?.(); };
  }, [prepareResolutionProbe]);
  // ── 监听 FFmpeg 下载进度事件 ────────────────────────────────────────────────
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

  // ── 监听视频压制进度事件 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<CompressProgressPayload>('video-compress-progress', (event) => {
        const p = event.payload;
        setCompressProgress(p.progress_pct);
        if (p.phase === 'done') {
          setIsPaused(false);
          setIsCanceling(false);
          setCompressPhase('done');
        } else if (p.phase === 'canceled') {
          setIsPaused(false);
          setIsCanceling(false);
          setCompressPhase('idle');
        } else if (p.phase === 'preparing' || p.phase === 'encoding') {
          setCompressPhase(p.phase);
        }
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  // ── FFmpeg 下载处理 ─────────────────────────────────────────────────────────
  const handleDownloadFfmpeg = useCallback(async () => {
    setFfmpegDownload({ ...INITIAL_DOWNLOAD, phase: 'speed-testing' });

    if (isTauri()) {
      try {
        await tauriDownloadFfmpeg();
      } catch (err) {
        console.error('FFmpeg download failed:', err);
        setFfmpegDownload(INITIAL_DOWNLOAD);
      }
    } else {
      // 浏览器 dev mock
      await new Promise((r) => setTimeout(r, 1200));
      setFfmpegDownload((prev) => ({ ...prev, phase: 'downloading', cdnSource: 'evermeet' }));
      const STEPS = 50;
      const TOTAL = 70 * 1024 * 1024; // ~70 MB mock
      for (let i = 1; i <= STEPS; i++) {
        await new Promise((r) => setTimeout(r, 80));
        const pct = (i / STEPS) * 100;
        setFfmpegDownload({
          phase: i === STEPS ? 'done' : 'downloading',
          percentage: pct,
          speedBps: 6_000_000 + Math.random() * 4_000_000,
          cdnSource: 'evermeet',
          downloadedBytes: Math.round((pct / 100) * TOTAL),
          totalBytes: TOTAL,
        });
      }
      setTimeout(() => setFfmpegStatus('available'), 600);
    }
  }, []);

  // ── 开始压制 ────────────────────────────────────────────────────────────────
  const handleCompress = useCallback(async () => {
    if (!droppedFile || ffmpegStatus !== 'available') return;
    setCompressPhase('preparing');
    setCompressProgress(0);
    setIsPaused(false);
    setIsCanceling(false);
    pauseRef.current = false;
    cancelRef.current = false;
    setOutputPath(null);
    setCompressError(null);

    if (isTauri()) {
      try {
        const out = await tauriCompressVideo(
          droppedFile.path ?? '',
          ensureMp4OutputPath(customOutputPath || defaultOutputPath(droppedFile.path ?? droppedFile.name)),
          targetHeight,
        );
        setOutputPath(out);
        setCompressPhase('done');
      } catch (err) {
        if (cancelRef.current || String(err).includes('压制已取消')) {
          setCompressPhase('idle');
          setCompressError(null);
        } else {
          console.error('Compression failed:', err);
          setCompressError(String(err));
          setCompressPhase('error');
        }
      } finally {
        setIsPaused(false);
        setIsCanceling(false);
        pauseRef.current = false;
        cancelRef.current = false;
      }
    } else {
      // 浏览器 dev mock：模拟读取信息 + 编码进度
      await new Promise((r) => setTimeout(r, 500));
      if (cancelRef.current) {
        setCompressPhase('idle');
        return;
      }
      setCompressPhase('encoding');
      const STEPS = 40;
      for (let i = 1; i <= STEPS; i++) {
        await new Promise((r) => setTimeout(r, 120));
        while (pauseRef.current && !cancelRef.current) {
          await new Promise((r) => setTimeout(r, 120));
        }
        if (cancelRef.current) {
          setCompressPhase('idle');
          setIsPaused(false);
          setIsCanceling(false);
          return;
        }
        setCompressProgress((i / STEPS) * 100);
      }
      setOutputPath(ensureMp4OutputPath(customOutputPath || '/mock/output/video_小版本.mp4'));
      setCompressPhase('done');
      setIsPaused(false);
      setIsCanceling(false);
    }
  }, [droppedFile, ffmpegStatus, targetHeight, customOutputPath]);

  const handlePause = useCallback(async () => {
    if (!isCompressing || isPaused || isCanceling) return;
    try {
      if (isTauri()) {
        await tauriPauseVideoCompression();
      }
      pauseRef.current = true;
      setIsPaused(true);
    } catch (err) {
      console.error('Pause compression failed:', err);
    }
  }, [isCompressing, isPaused, isCanceling]);

  const handleResume = useCallback(async () => {
    if (!isCompressing || !isPaused || isCanceling) return;
    try {
      if (isTauri()) {
        await tauriResumeVideoCompression();
      }
      pauseRef.current = false;
      setIsPaused(false);
    } catch (err) {
      console.error('Resume compression failed:', err);
    }
  }, [isCompressing, isPaused, isCanceling]);

  const handleCancelCompression = useCallback(async () => {
    if (!isCompressing || isCanceling) return;
    cancelRef.current = true;
    pauseRef.current = false;
    setIsPaused(false);
    setIsCanceling(true);
    try {
      if (isTauri()) {
        await tauriCancelVideoCompression();
      } else {
        setCompressPhase('idle');
        setIsCanceling(false);
      }
    } catch (err) {
      console.error('Cancel compression failed:', err);
      setIsCanceling(false);
    }
  }, [isCompressing, isCanceling]);

  // ── 文件拖拽 ────────────────────────────────────────────────────────────────
  // 非 Tauri 环境（浏览器 dev）才使用 HTML DnD
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    if (isCompressing) return;
    setIsDragging(true);
  }, [isCompressing]);
  const handleDragLeave = useCallback(() => {
    if (isTauri()) return;
    setIsDragging(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    setIsDragging(false);
    if (isCompressing) return;
    const file = e.dataTransfer.files[0];
    if (file) {
      prepareResolutionProbe();
      setDroppedFile({ name: file.name, size: file.size, file });
      setCustomOutputPath(defaultOutputPath(file.name));
      setCompressPhase('idle');
      setIsPaused(false);
      setIsCanceling(false);
      setOutputPath(null);
      setCompressError(null);
    }
  }, [isCompressing, prepareResolutionProbe]);

  // 点击浏览——Tauri 下用 dialog，浏览器用 file input
  const handleBrowse = useCallback(async () => {
    if (droppedFile || isCompressing) return;
    if (isTauri()) {
      const picked = await pickVideoFile();
      if (picked) {
        prepareResolutionProbe();
        setDroppedFile({ name: picked.name, size: 0, path: picked.path });
        setCustomOutputPath(defaultOutputPath(picked.path));
        setCompressPhase('idle');
        setIsPaused(false);
        setIsCanceling(false);
        setOutputPath(null);
        setCompressError(null);
        // Fetch actual file size from Rust
        const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
        tauriInvoke<number>('get_file_size', { path: picked.path }).then((sz) => {
          setDroppedFile((prev) => prev?.path === picked.path ? { ...prev, size: sz } : prev);
        }).catch(() => {/* ignore */});
      }
    } else {
      fileInputRef.current?.click();
    }
  }, [droppedFile, isCompressing, prepareResolutionProbe]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (isCompressing) return;
    const file = e.target.files?.[0];
    if (file) {
      prepareResolutionProbe();
      setDroppedFile({ name: file.name, size: file.size, file });
      setCustomOutputPath(defaultOutputPath(file.name));
      setCompressPhase('idle');
      setIsPaused(false);
      setIsCanceling(false);
      setOutputPath(null);
      setCompressError(null);
    }
  }, [isCompressing, prepareResolutionProbe]);
  const handleClearFile = useCallback(() => {
    if (isCompressing) return;
    setDroppedFile(null);
    setCompressPhase('idle');
    setIsPaused(false);
    setIsCanceling(false);
    setOutputPath(null);
    setCompressError(null);
    setCustomOutputPath('');
    setVideoResolution(null);
    setVideoResolutionError(null);
    setVideoResolutionStatus('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [isCompressing]);

  // ── 渲染操作按钮 ───────────────────────────────────────────────────────────
  const renderActionButton = () => {
    if (ffmpegStatus === 'checking') {
      return (
        <Button className="w-full gap-2" size="lg" disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
          {cv.ffmpegChecking}
        </Button>
      );
    }

    if (ffmpegStatus === 'not-found') {
      return (
        <Button
          className="w-full gap-2"
          size="lg"
          variant="outline"
          disabled={isDownloading}
          onClick={handleDownloadFfmpeg}
        >
          {isDownloading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Download className="h-4 w-4" />}
          {isDownloading
            ? ffmpegDownload.phase === 'speed-testing'
              ? cv.ffmpegDownloadSpeedTesting
              : `${Math.round(ffmpegDownload.percentage)}%`
            : `${cv.downloadFfmpeg}`}
        </Button>
      );
    }

    if (compressPhase === 'error') {
      return (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive leading-relaxed break-all">
              {compressError ?? '压制失败'}
            </p>
          </div>
          <Button className="w-full gap-2" variant="outline" onClick={() => setCompressPhase('idle')}>
            重试
          </Button>
        </div>
      );
    }

    if (compressPhase === 'done') {
      const folderPath = outputPath
        ? outputPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
        : null;

      const handleOpenFolder = async () => {
        if (!isTauri() || !folderPath) return;
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_path', { path: folderPath });
      };

      const handleOpenFile = async () => {
        if (!isTauri() || !outputPath) return;
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_path', { path: outputPath });
      };

      return (
        <div className="space-y-2 animate-in fade-in duration-300">
          <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            <p className="text-sm font-medium text-green-400">{cv.compressComplete}</p>
          </div>
          <Button className="w-full gap-2" variant="outline" onClick={handleOpenFolder} disabled={!isTauri() || !folderPath}>
            <FolderOpen className="h-4 w-4" />
            {cv.openOutputFolder}
          </Button>
          <Button className="w-full gap-2" variant="outline" onClick={handleOpenFile} disabled={!isTauri() || !outputPath}>
            <Film className="h-4 w-4" />
            {cv.openOutput}
          </Button>
        </div>
      );
    }

    if (isCompressing) {
      const statusText = isCanceling
        ? cv.cancelingCompress
        : isPaused
        ? cv.compressPaused
        : compressPhase === 'preparing'
        ? cv.preparingCompress
        : cv.compressing;

      return (
        <div className="space-y-2">
          <Button className="w-full gap-2" size="lg" disabled>
            {isPaused
              ? <Pause className="h-4 w-4" />
              : <Loader2 className="h-4 w-4 animate-spin" />}
            {statusText}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="gap-2"
              variant="outline"
              onClick={isPaused ? handleResume : handlePause}
              disabled={isCanceling || compressPhase === 'preparing'}
            >
              {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {isPaused ? cv.resumeCompress : cv.pauseCompress}
            </Button>
            <Button
              className="gap-2"
              variant="destructive"
              onClick={handleCancelCompression}
              disabled={isCanceling}
            >
              <Square className="h-4 w-4" />
              {cv.cancelCompress}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <Button
        className="w-full gap-2"
        size="lg"
        disabled={!droppedFile}
        onClick={handleCompress}
      >
        <Gauge className="h-4 w-4" />
        {cv.startCompress}
      </Button>
    );
  };

  // ─── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15">
          <Film className="h-5 w-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">{cv.title}</h1>
          <p className="text-sm text-muted-foreground">{cv.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* ── 左栏 ────────────────────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* 拖放区 */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div
              className={cn(
                'relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed transition-all duration-200',
                isDragging
                  ? 'border-blue-400 bg-blue-500/10 scale-[1.01]'
                  : droppedFile
                  ? 'border-green-500/50 bg-green-500/5'
                  : 'border-border bg-muted/30 hover:border-blue-400/50 hover:bg-muted/50'
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleBrowse}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleBrowse()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mkv,.mp4,.mov,.avi,.ts,.wmv"
                className="sr-only"
                onChange={handleFileChange}
              />
              {droppedFile ? (
                <div className="flex flex-col items-center gap-2 text-center px-4">
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                  <p className="font-medium text-foreground">{droppedFile.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(droppedFile.size)}</p>
                  {videoResolutionStatus !== 'idle' && (
                    <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                      {videoResolutionStatus === 'done' && videoResolution && estimatedOutputResolution ? (
                        <>
                          <p>{cv.currentResolution}: {videoResolution.width} x {videoResolution.height}</p>
                          <p className="text-blue-400">
                            {cv.estimatedOutputResolution}: {estimatedOutputResolution.width} x {estimatedOutputResolution.height}
                          </p>
                        </>
                      ) : (
                        <p className="flex items-center gap-1.5">
                          {videoResolutionStatus === 'loading' && <Loader2 className="h-3 w-3 animate-spin text-blue-400" />}
                          {videoResolutionStatus === 'loading'
                            ? cv.readingResolution
                            : videoResolutionStatus === 'unavailable'
                            ? cv.resolutionUnavailable
                            : `${cv.resolutionReadFailed}${videoResolutionError ? `: ${videoResolutionError}` : ''}`}
                        </p>
                      )}
                    </div>
                  )}
                  <button
                    className="mt-1 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground"
                    disabled={isCompressing}
                    onClick={(e) => { e.stopPropagation(); handleClearFile(); }}
                  >
                    <X className="h-3 w-3" /> Remove
                  </button>
                </div>
              ) : (
                <>
                  <div
                    className={cn(
                      'flex h-14 w-14 items-center justify-center rounded-full transition-colors',
                      isDragging ? 'bg-blue-500/20' : 'bg-muted'
                    )}
                  >
                    {isDragging
                      ? <FileVideo className="h-7 w-7 text-blue-400 animate-bounce" />
                      : <UploadCloud className="h-7 w-7 text-muted-foreground" />}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">{cv.dropzone}</p>
                    <p className="text-xs text-muted-foreground mt-1">{cv.dropzoneHint}</p>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 输出设置 */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-blue-400 inline-block" />
              {cv.outputSettings}
            </h2>

            {/* 目标分辨率 */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">{cv.resolution}</Label>
              <Select
                value={String(targetHeight)}
                onValueChange={(v) => setTargetHeight(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <span className="font-medium text-sm">{selectedPreset.label}</span>
                </SelectTrigger>
                <SelectContent>
                  {RESOLUTION_PRESETS.map((p) => (
                    <SelectItem key={p.height} value={String(p.height)}>
                      <span className="font-medium">{p.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* 输出路径 */}
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground flex items-center gap-1.5">
                <FolderInput className="h-3.5 w-3.5" />
                {locale === 'zh' ? '输出路径' : 'Output Path'}
              </Label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={customOutputPath}
                  onChange={(e) => setCustomOutputPath(e.target.value)}
                  onBlur={() => setCustomOutputPath((path) => ensureMp4OutputPath(path))}
                  placeholder=""
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                {isTauri() && (
                  <button
                    type="button"
                    title={locale === 'zh' ? '选择输出目录' : 'Choose output folder'}
                    className="flex items-center justify-center rounded-md border border-border bg-muted/50 px-2 hover:bg-muted transition-colors"
                    onClick={async () => {
                      const { open } = await import('@tauri-apps/plugin-dialog');
                      const dir = await open({ directory: true, multiple: false });
                      if (typeof dir === 'string' && dir) {
                        const normalized = dir.replace(/\\/g, '/');
                        const filenameFromPath = customOutputPath.replace(/\\/g, '/').split('/').pop() ?? '';
                        const fallbackName = droppedFile
                          ? defaultOutputPath(droppedFile.path ?? droppedFile.name).replace(/\\/g, '/').split('/').pop() ?? ''
                          : '';
                        const filename = filenameFromPath || fallbackName;
                        setCustomOutputPath(filename ? ensureMp4OutputPath(`${normalized}/${filename}`) : normalized);
                      }
                    }}
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>

            </div>
          </section>
        </div>

        {/* ── 右栏 ────────────────────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* FFmpeg 管理 */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-blue-400 inline-block" />
              {cv.ffmpegManager}
            </h2>

            {/* 状态徽标 */}
            <div
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-300',
                ffmpegStatus === 'checking' && 'bg-muted/50 text-muted-foreground',
                ffmpegStatus === 'available' && 'bg-green-500/10 border border-green-500/20 text-green-400',
                ffmpegStatus === 'not-found' && 'bg-amber-500/10 border border-amber-500/20 text-amber-400',
              )}
            >
              {ffmpegStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
              {ffmpegStatus === 'available' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
              {ffmpegStatus === 'not-found' && <AlertCircle className="h-4 w-4 shrink-0" />}
              <span className="font-medium text-xs">
                {ffmpegStatus === 'checking' && cv.ffmpegChecking}
                {ffmpegStatus === 'available' && cv.ffmpegAvailable}
                {ffmpegStatus === 'not-found' && cv.ffmpegNotFound}
              </span>
            </div>

            {/* FFmpeg 下载进度 */}
            {(isDownloading || ffmpegDownload.phase === 'done') && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <Separator />
                {ffmpegDownload.cdnSource && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Wifi className="h-3 w-3 text-blue-400" />
                    <span>{cv.ffmpegDownloadingFrom}:</span>
                    <span className="font-medium text-foreground capitalize">
                      {ffmpegDownload.cdnSource}
                    </span>
                    {ffmpegDownload.speedBps > 0 && (
                      <span className="ml-auto tabular-nums text-blue-400">
                        {formatSpeed(ffmpegDownload.speedBps)}
                      </span>
                    )}
                  </div>
                )}
                {ffmpegDownload.phase === 'speed-testing' && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                    <span>{cv.ffmpegDownloadSpeedTesting}</span>
                  </div>
                )}
                <Progress value={ffmpegDownload.percentage} className="h-2" />
                <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                  <span>{formatBytes(ffmpegDownload.downloadedBytes)}</span>
                  <span className="font-semibold text-blue-400">
                    {Math.round(ffmpegDownload.percentage)}%
                  </span>
                  <span>{formatBytes(ffmpegDownload.totalBytes)}</span>
                </div>
                {ffmpegDownload.phase === 'done' && (
                  <div className="flex items-center gap-2 text-xs text-green-400">
                    <Package className="h-3.5 w-3.5" />
                    {cv.ffmpegDownloadComplete}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 操作面板 */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-3">
            {renderActionButton()}

            {/* 压制进度条 */}
            {isCompressing && (
              <div className="space-y-2 animate-in fade-in duration-200">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Gauge className="h-3 w-3 text-blue-400" />
                  <span>
                    {isCanceling
                      ? cv.cancelingCompress
                      : isPaused
                      ? cv.compressPaused
                      : compressPhase === 'preparing'
                      ? cv.preparingCompress
                      : cv.compressing}
                  </span>
                  <span className="ml-auto tabular-nums text-blue-400">
                    {Math.round(compressProgress)}%
                  </span>
                </div>
                <Progress value={compressProgress} className="h-2" />
              </div>
            )}
          </section>

          {/* 即将执行的 FFmpeg 命令 */}
          {droppedFile && pendingCommand && (
            <section className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">{cv.pendingCommand}</p>
                <CopyButton text={pendingCommand} label={cv.copy} copiedLabel={cv.copied} />
              </div>
              <pre className="max-h-52 w-full select-all overflow-y-auto break-all whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground">
                {pendingCommand}
              </pre>
            </section>
          )}

          {/* 输出文件信息 */}
          {compressPhase === 'done' && outputPath && (
            <section className="rounded-xl border border-border bg-card p-4 space-y-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {locale === 'zh' ? '输出文件' : 'Output File'}
              </p>
              <p className="text-xs font-mono text-foreground break-all">{outputPath}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
