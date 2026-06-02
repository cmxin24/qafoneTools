import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { cn } from '@/components/ui/utils';
import { ArrowLeft, Film, FileCode2, Wand2, Copy, Check, FolderOpen } from 'lucide-react';

// ─── Runtime environment check ─────────────────────────────────────────────────

const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── Constants ─────────────────────────────────────────────────────────────────

const PRESETS = [
  'ultrafast', 'superfast', 'veryfast', 'faster', 'fast',
  'medium', 'slow', 'slower', 'veryslow',
] as const;
type Preset = (typeof PRESETS)[number];

type Codec = 'libx264' | 'libx265';

// ─── Tauri helpers ─────────────────────────────────────────────────────────────

async function tauriReadTextFile(path: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_text_file', { path });
}

async function pickVideoFile(): Promise<{ path: string; name: string } | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: false,
    filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'ts', 'wmv', 'm4v', 'webm'] }],
  });
  if (typeof result === 'string' && result) {
    return { path: result, name: result.replace(/\\/g, '/').split('/').pop() ?? result };
  }
  return null;
}

async function pickAssFile(): Promise<{ path: string; name: string } | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: false,
    filters: [{ name: 'ASS Subtitle', extensions: ['ass'] }],
  });
  if (typeof result === 'string' && result) {
    return { path: result, name: result.replace(/\\/g, '/').split('/').pop() ?? result };
  }
  return null;
}

async function pickOutputFile(defaultName: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    defaultPath: defaultName,
    filters: [
      { name: 'MP4 Video', extensions: ['mp4'] },
      { name: 'MKV Video', extensions: ['mkv'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return path ?? null;
}

// ─── Escape helpers ────────────────────────────────────────────────────────────

/**
 * Escape a file path for use inside an FFmpeg -vf "ass=<path>" filter string.
 * FFmpeg's lavfi filter graph uses ':' and '\' as special characters.
 * On Windows drive letters like C: must become C\:.
 */
function escapeAssPath(p: string): string {
  // Normalize to forward slashes first
  let escaped = p.replace(/\\/g, '/');
  // Escape Windows drive letter colon (e.g. C:/ → C\:/)
  escaped = escaped.replace(/^([A-Za-z]):\//, '$1\\:/');
  // Escape any remaining colons that are not part of the drive prefix
  escaped = escaped.replace(/(?<!^[A-Za-z]\\):/, '\\:');
  // Escape single quotes used by the shell wrapper
  escaped = escaped.replace(/'/g, "\\'");
  return escaped;
}

/**
 * Wrap a path in double quotes if it contains spaces.
 */
function quotePath(p: string): string {
  return p.includes(' ') ? `"${p}"` : p;
}

// ─── Command builder ───────────────────────────────────────────────────────────

interface CommandParams {
  videoPath: string;
  assPath: string;
  codec: Codec;
  preset: Preset;
  crf: number;
  // test segment
  testStart: string;
  testDuration: number;
  testOutput: string;
  // full encode
  fullOutput: string;
}

function buildTestCommand(p: CommandParams): string {
  const vf = `ass=${escapeAssPath(p.assPath)}`;
  return [
    'ffmpeg',
    '-i', quotePath(p.videoPath),
    '-vf', `"${vf}"`,
    '-c:v', p.codec,
    '-preset', p.preset,
    '-crf', String(p.crf),
    '-c:a', 'copy',
    '-ss', p.testStart,
    '-t', String(p.testDuration),
    quotePath(p.testOutput),
  ].join(' ');
}

function buildFullCommand(p: CommandParams): string {
  const vf = `ass=${escapeAssPath(p.assPath)}`;
  return [
    'ffmpeg',
    '-i', quotePath(p.videoPath),
    '-vf', `"${vf}"`,
    '-c:v', p.codec,
    '-preset', p.preset,
    '-crf', String(p.crf),
    '-c:a', 'copy',
    quotePath(p.fullOutput),
  ].join(' ');
}

// ─── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? <Check className="mr-2 h-3.5 w-3.5 text-green-500" /> : <Copy className="mr-2 h-3.5 w-3.5" />}
      {copied ? copiedLabel : label}
    </Button>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function FfmpegCodeGeneratorPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const fg = t.ffmpegCodeGen;
  const ep = t.encodingPage;

  // ── File state ─────────────────────────────────────────────────────────────
  const [videoPath, setVideoPath] = useState('');
  const [videoName, setVideoName] = useState('');
  const [assPath, setAssPath] = useState('');
  const [assName, setAssName] = useState('');
  const [vidDragging, setVidDragging] = useState(false);
  const [assDragging, setAssDragging] = useState(false);

  // ── Encode settings ────────────────────────────────────────────────────────
  const [codec, setCodec] = useState<Codec>('libx264');
  const [preset, setPreset] = useState<Preset>('slow');
  const [crf, setCrf] = useState(19);

  // ── Test segment ───────────────────────────────────────────────────────────
  const [testStart, setTestStart] = useState('0:00:35.00');
  const [testDuration, setTestDuration] = useState(20);
  const [testOutput, setTestOutput] = useState('');

  // ── Full encode ────────────────────────────────────────────────────────────
  const [fullOutput, setFullOutput] = useState('');

  // ── Generated commands ─────────────────────────────────────────────────────
  const [testCmd, setTestCmd] = useState('');
  const [fullCmd, setFullCmd] = useState('');
  const [generateError, setGenerateError] = useState<string | null>(null);

  const vidInputRef = useRef<HTMLInputElement>(null);
  const assInputRef = useRef<HTMLInputElement>(null);
  const locationPathRef = useRef('/encoding/ffmpeg-code-gen');

  // ── Tauri drag-drop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;

    (async () => {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      unlisten = await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
        if (locationPathRef.current !== '/encoding/ffmpeg-code-gen') return;
        const { type } = event.payload;
        if (type === 'leave') { setVidDragging(false); setAssDragging(false); return; }
        if (type !== 'drop' || !('paths' in event.payload)) return;
        setVidDragging(false);
        setAssDragging(false);

        const paths: string[] = event.payload.paths;
        const vidExts = ['.mp4', '.mkv', '.mov', '.avi', '.ts', '.wmv', '.m4v', '.webm'];

        for (const p of paths) {
          const lower = p.toLowerCase();
          const name = p.replace(/\\/g, '/').split('/').pop() ?? p;
          if (lower.endsWith('.ass')) {
            try {
              // Verify it's readable
              await tauriReadTextFile(p);
              setAssPath(p);
              setAssName(name);
            } catch { /* ignore */ }
          } else if (vidExts.some((ext) => lower.endsWith(ext))) {
            setVideoPath(p);
            setVideoName(name);
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
      if (picked) { setVideoPath(picked.path); setVideoName(picked.name); }
    } else {
      vidInputRef.current?.click();
    }
  }, []);

  const handleVidInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setVideoName(file.name); setVideoPath(file.name); }
    e.target.value = '';
  }, []);

  const handleVidDragOver = useCallback((e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    setVidDragging(true);
  }, []);
  const handleVidDragLeave = useCallback(() => { if (!isTauri()) setVidDragging(false); }, []);
  const handleVidDrop = useCallback((e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    setVidDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) { setVideoName(file.name); setVideoPath(file.name); }
  }, []);

  // ── ASS handlers ───────────────────────────────────────────────────────────
  const handleAssBrowse = useCallback(async () => {
    if (isTauri()) {
      const picked = await pickAssFile();
      if (picked) { setAssPath(picked.path); setAssName(picked.name); }
    } else {
      assInputRef.current?.click();
    }
  }, []);

  const handleAssInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setAssName(file.name); setAssPath(file.name); }
    e.target.value = '';
  }, []);

  const handleAssDragOver = useCallback((e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    setAssDragging(true);
  }, []);
  const handleAssDragLeave = useCallback(() => { if (!isTauri()) setAssDragging(false); }, []);
  const handleAssDrop = useCallback((e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    setAssDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) { setAssName(file.name); setAssPath(file.name); }
  }, []);

  // ── Output path pickers ────────────────────────────────────────────────────
  const handlePickTestOutput = useCallback(async () => {
    const path = await pickOutputFile(videoName ? `test_${videoName.replace(/\.[^.]+$/, '.mp4')}` : 'test_output.mp4');
    if (path) setTestOutput(path);
  }, [videoName]);

  const handlePickFullOutput = useCallback(async () => {
    const path = await pickOutputFile(videoName ? videoName.replace(/\.[^.]+$/, '_encoded.mp4') : 'output.mp4');
    if (path) setFullOutput(path);
  }, [videoName]);

  // ── Auto-fill output paths when video is selected ──────────────────────────
  useEffect(() => {
    if (!videoPath) return;
    const normalized = videoPath.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash < 0) return; // browser-mode filename only, no directory
    const dir = normalized.slice(0, lastSlash);
    const base = normalized.slice(lastSlash + 1).replace(/\.[^.]+$/, '');
    setTestOutput(`${dir}/${base}_test.mp4`);
    setFullOutput(`${dir}/${base}_ZH.mp4`);
  }, [videoPath]);

  // ── Generate ───────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(() => {
    setGenerateError(null);
    if (!videoPath) { setGenerateError(fg.noVideo); return; }
    if (!assPath) { setGenerateError(fg.noAss); return; }
    if (!testOutput) { setGenerateError(fg.noTestOutput); return; }
    if (!fullOutput) { setGenerateError(fg.noFullOutput); return; }

    const params: CommandParams = {
      videoPath, assPath, codec, preset, crf,
      testStart, testDuration, testOutput, fullOutput,
    };

    setTestCmd(buildTestCommand(params));
    setFullCmd(buildFullCommand(params));
  }, [videoPath, assPath, codec, preset, crf, testStart, testDuration, testOutput, fullOutput, fg]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/encoding')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-base font-semibold">{ep.ffmpegCodeGenTitle}</h1>
          <p className="text-xs text-muted-foreground">{ep.ffmpegCodeGenDesc}</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">

        {/* File inputs */}
        <section className="grid gap-4 sm:grid-cols-2">
          {/* Video */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{fg.videoFile}</p>
            <div
              onDragOver={handleVidDragOver}
              onDragLeave={handleVidDragLeave}
              onDrop={handleVidDrop}
              onClick={handleVidBrowse}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-6 transition-colors',
                vidDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
              )}
            >
              <Film className="h-6 w-6 text-muted-foreground" />
              {videoName
                ? <p className="max-w-full truncate px-4 text-sm text-foreground">{videoName}</p>
                : <>
                    <p className="text-sm text-muted-foreground">{fg.videoDropzone}</p>
                    <p className="text-xs text-muted-foreground/60">{fg.videoDropzoneHint}</p>
                  </>
              }
            </div>
            <input ref={vidInputRef} type="file" accept=".mp4,.mkv,.mov,.avi,.ts,.wmv,.m4v,.webm" className="hidden" onChange={handleVidInputChange} />
          </div>

          {/* ASS */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{fg.assFile}</p>
            <div
              onDragOver={handleAssDragOver}
              onDragLeave={handleAssDragLeave}
              onDrop={handleAssDrop}
              onClick={handleAssBrowse}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-6 transition-colors',
                assDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
              )}
            >
              <FileCode2 className="h-6 w-6 text-muted-foreground" />
              {assName
                ? <p className="max-w-full truncate px-4 text-sm text-foreground">{assName}</p>
                : <>
                    <p className="text-sm text-muted-foreground">{fg.assDropzone}</p>
                    <p className="text-xs text-muted-foreground/60">{fg.assDropzoneHint}</p>
                  </>
              }
            </div>
            <input ref={assInputRef} type="file" accept=".ass" className="hidden" onChange={handleAssInputChange} />
          </div>
        </section>

        {/* Encode settings */}
        <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">{fg.encodeSettings}</p>
          <div className="flex flex-wrap gap-3">

            {/* Codec toggle */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">{fg.codec}</label>
              <div className="flex h-9 rounded-md border border-border overflow-hidden">
                {(['libx264', 'libx265'] as Codec[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCodec(c)}
                    className={cn(
                      'px-4 text-xs font-medium transition-colors',
                      codec === c
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {c === 'libx264' ? 'x264' : 'x265'}
                  </button>
                ))}
              </div>
            </div>

            {/* Preset */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">{fg.preset}</label>
              <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
                <SelectTrigger className="h-9 w-36 text-sm">
                  <span className="font-medium">{preset}</span>
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p} value={p}>
                      <span className="font-medium">{p}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* CRF */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">{fg.crf}</label>
              <div className="flex h-9 items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={51}
                  value={crf}
                  onChange={(e) => setCrf(Number(e.target.value))}
                  className="w-32 accent-primary"
                />
                <input
                  type="number"
                  min={0}
                  max={51}
                  value={crf}
                  onChange={(e) => setCrf(Math.min(51, Math.max(0, Number(e.target.value))))}
                  className="h-9 w-14 rounded-md border border-border bg-card px-2 text-center text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Test segment settings */}
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-semibold">{fg.testSegment}</p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{fg.testStart}</label>
              <input
                value={testStart}
                onChange={(e) => setTestStart(e.target.value)}
                placeholder="H:MM:SS.cc"
                className="w-36 rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{fg.testDuration}</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  value={testDuration}
                  onChange={(e) => setTestDuration(Math.max(1, Number(e.target.value)))}
                  className="w-20 rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <span className="text-xs text-muted-foreground">{fg.seconds}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{fg.testOutputPath}</label>
            <div className="flex gap-2">
              <input
                value={testOutput}
                onChange={(e) => setTestOutput(e.target.value)}
                placeholder=""
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {isTauri() && (
                <Button variant="outline" size="icon" className="shrink-0" onClick={handlePickTestOutput}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* Full encode settings */}
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-semibold">{fg.fullEncode}</p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{fg.fullOutputPath}</label>
            <div className="flex gap-2">
              <input
                value={fullOutput}
                onChange={(e) => setFullOutput(e.target.value)}
                placeholder=""
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {isTauri() && (
                <Button variant="outline" size="icon" className="shrink-0" onClick={handlePickFullOutput}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* Generate button */}
        <div className="flex flex-col gap-2">
          <Button onClick={handleGenerate} className="self-start">
            <Wand2 className="mr-2 h-4 w-4" />
            {fg.generate}
          </Button>
          {generateError && <p className="text-xs text-destructive">{generateError}</p>}
        </div>

        {/* Output commands */}
        {(testCmd || fullCmd) && (
          <section className="flex flex-col gap-4">
            {testCmd && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{fg.testCommand}</p>
                  <CopyButton text={testCmd} label={fg.copy} copiedLabel={fg.copied} />
                </div>
                <pre className="w-full select-all break-all whitespace-pre-wrap rounded-xl border border-border bg-card px-4 py-3 font-mono text-xs text-foreground">
                  {testCmd}
                </pre>
              </div>
            )}
            {fullCmd && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{fg.fullCommand}</p>
                  <CopyButton text={fullCmd} label={fg.copy} copiedLabel={fg.copied} />
                </div>
                <pre className="w-full select-all break-all whitespace-pre-wrap rounded-xl border border-border bg-card px-4 py-3 font-mono text-xs text-foreground">
                  {fullCmd}
                </pre>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
