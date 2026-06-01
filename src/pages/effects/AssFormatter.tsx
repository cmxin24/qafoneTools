import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  FileText,
  Film,
  Wand2,
  Download,
  X,
  MonitorPlay,
} from 'lucide-react';

// ─── Runtime environment check ─────────────────────────────────────────────────

const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── Style Presets ─────────────────────────────────────────────────────────────
//
// Each preset specifies the complete [V4+ Styles] block for that resolution.
// The "Logo" style uses fixed dimensions across all presets.

const STYLES_FORMAT =
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';

const LOGO_STYLE =
  'Style: Logo,Microsoft YaHei,12,&H58FFFFFF,&HF0000000,&H00000000,&HF0000000,0,0,0,0,200,230,0,0,0,0,0,2,0,0,0,1';

const PRESET_1080P = `${STYLES_FORMAT}
Style: Default,FZZhunYuan-M02,64,&H28FFFFFF,&H00000000,&H28FFFFFF,&H80000000,0,0,0,0,100,100,12.0,0,1,0.2,2.4,2,53,53,110,1
Style: DefaultEN,Arial,45,&H28FFFFFF,&H00000000,&H00000000,&H80000000,-1,0,0,0,100,100,0.0,0,1,0.1,1.7,2,53,53,110,1
Style: 片名,Noto Sans SC Medium,69,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,4.0,0,0,0.0,0.0,2,53,53,325,1
Style: 无边框无阴影,Noto Sans SC Medium,69,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,4.0,0,0,0.0,0.0,7,53,53,48,1
Style: 制作名单,FZZhunYuan-M02,59,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100.0,100.0,4.0,0,1,0,0,4,53,53,48,1
Style: 说明,Noto Sans SC Medium,64,&H3CFFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,4.0,0,1,0.0,0.0,2,53,53,64,1
${LOGO_STYLE}`;

const PRESET_720P = `${STYLES_FORMAT}
Style: Default,FZZhunYuan-M02,36,&H28FFFFFF,&H00000000,&H28FFFFFF,&H80000000,0,0,0,0,100,100,6.8,0,1,0.1,1.4,2,30,30,62,1
Style: DefaultEN,Arial,25,&H28FFFFFF,&H00000000,&H00000000,&H80000000,-1,0,0,0,100,100,0.0,0,1,0.1,1.0,2,30,30,62,1
Style: 片名,Noto Sans SC Medium,39,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,2.3,0,0,0.0,0.0,2,30,30,183,1
Style: 无边框无阴影,Noto Sans SC Medium,39,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,2.3,0,0,0.0,0.0,7,30,30,27,1
Style: 制作名单,FZZhunYuan-M02,33,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,2.3,0,1,0,0,4,30,30,27,1
Style: 说明,Noto Sans SC Medium,36,&H3CFFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,2.3,0,1,0.0,0.0,2,30,30,36,1
${LOGO_STYLE}`;

const PRESET_480P = `${STYLES_FORMAT}
Style: Default,FZZhunYuan-M02,24,&H28FFFFFF,&H00000000,&H28FFFFFF,&H80000000,0,0,0,0,100,100,4.5,0,1,0.1,0.9,2,20,20,41,1
Style: DefaultEN,Arial,17,&H28FFFFFF,&H00000000,&H00000000,&H80000000,-1,0,0,0,100,100,0.0,0,1,0.1,0.6,2,20,20,41,1
Style: 片名,Noto Sans SC Medium,26,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,1.5,0,0,0.0,0.0,2,20,20,122,1
Style: 无边框无阴影,Noto Sans SC Medium,26,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,1.5,0,0,0.0,0.0,7,20,20,18,1
Style: 制作名单,FZZhunYuan-M02,22,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,1.5,0,1,0,0,4,20,20,18,1
Style: 说明,Noto Sans SC Medium,24,&H3CFFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,1.5,0,1,0.0,0.0,2,20,20,24,1
${LOGO_STYLE}`;

// ─── Style scaling ─────────────────────────────────────────────────────────────

/** Round to 1 decimal place */
function f1(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1);
}

/** Round to nearest integer */
function fi(v: number): number {
  return Math.round(v);
}

/**
 * Build a scaled [V4+ Styles] block for an arbitrary resolution by linearly
 * scaling the 720p base values by (height / 720).
 */
function buildScaledStylesBlock(height: number): string {
  const r = height / 720;
  const lines = [
    STYLES_FORMAT,
    `Style: Default,FZZhunYuan-M02,${fi(36 * r)},&H28FFFFFF,&H00000000,&H28FFFFFF,&H80000000,0,0,0,0,100,100,${f1(6.8 * r)},0,1,${f1(0.1 * r)},${f1(1.4 * r)},2,${fi(30 * r)},${fi(30 * r)},${fi(62 * r)},1`,
    `Style: DefaultEN,Arial,${fi(25 * r)},&H28FFFFFF,&H00000000,&H00000000,&H80000000,-1,0,0,0,100,100,0.0,0,1,${f1(0.1 * r * 25 / 36)},${f1(1.4 * r * 25 / 36)},2,${fi(30 * r)},${fi(30 * r)},${fi(62 * r)},1`,
    `Style: 片名,Noto Sans SC Medium,${fi(39 * r)},&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,${f1(2.3 * r)},0,0,0.0,0.0,2,${fi(30 * r)},${fi(30 * r)},${fi(183 * r)},1`,
    `Style: 无边框无阴影,Noto Sans SC Medium,${fi(39 * r)},&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,${f1(2.3 * r)},0,0,0.0,0.0,7,${fi(30 * r)},${fi(30 * r)},${fi(27 * r)},1`,
    `Style: 制作名单,FZZhunYuan-M02,${fi(33 * r)},&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,${f1(2.3 * r)},0,1,0,0,4,${fi(30 * r)},${fi(30 * r)},${fi(27 * r)},1`,
    `Style: 说明,Noto Sans SC Medium,${fi(36 * r)},&H3CFFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,${f1(2.3 * r)},0,1,0.0,0.0,2,${fi(30 * r)},${fi(30 * r)},${fi(36 * r)},1`,
    LOGO_STYLE,
  ];
  return lines.join('\n');
}

function getStylesBlock(width: number, height: number): string {
  if (height === 1080 || (width === 1920 && height === 1080)) return PRESET_1080P;
  if (height === 720 || (width === 1280 && height === 720)) return PRESET_720P;
  if (height === 480 || (width === 854 && height === 480)) return PRESET_480P;
  return buildScaledStylesBlock(height);
}

// ─── Language detection ────────────────────────────────────────────────────────

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/.test(text);
}

/**
 * Returns true when the subtitle content contains both Chinese and non-Chinese
 * dialogue lines, indicating it is an unseparated bilingual file.
 */
function detectBilingual(content: string, filename: string): boolean {
  const lower = filename.toLowerCase();
  let hasChinese = false;
  let hasForeign = false;

  if (lower.endsWith('.ass')) {
    let inEvents = false;
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.toLowerCase() === '[events]') { inEvents = true; continue; }
      if (line.startsWith('[') && line.endsWith(']')) { inEvents = false; continue; }
      if (!inEvents || !line.startsWith('Dialogue:')) continue;
      const parts = line.slice('Dialogue:'.length).trimStart().split(',');
      if (parts.length < 10) continue;
      const text = parts.slice(9).join(',');
      const plain = text.replace(/\{[^}]*\}/g, ''); // strip ASS override tags
      if (containsChinese(plain)) hasChinese = true;
      else if (plain.trim()) hasForeign = true;
      if (hasChinese && hasForeign) return true;
    }
  } else {
    // SRT
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (const block of normalized.split(/\n{2,}/)) {
      const lines = block.trim().split('\n');
      if (lines.length < 3) continue;
      if (!/^\d+$/.test(lines[0].trim()) || !lines[1].includes('-->')) continue;
      for (const line of lines.slice(2)) {
        if (!line.trim()) continue;
        if (containsChinese(line)) hasChinese = true;
        else hasForeign = true;
        if (hasChinese && hasForeign) return true;
      }
    }
  }
  return false;
}

// ─── Timestamp conversion ──────────────────────────────────────────────────────

/** Convert SRT timestamp "00:01:16,777" → ASS "0:01:16.77" */
function srtTimeToAss(srt: string): string {
  const [time, ms] = srt.split(',');
  const [hh, mm, ss] = time.split(':');
  const h = parseInt(hh, 10);
  const cs = Math.floor(parseInt(ms ?? '0', 10) / 10)
    .toString()
    .padStart(2, '0');
  return `${h}:${mm}:${ss}.${cs}`;
}

/** Convert ASS timestamp "0:01:16.77" to milliseconds (for sorting). */
function assTimeToMs(ass: string): number {
  const parts = ass.split(':');
  if (parts.length < 3) return 0;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const [secStr, csStr] = parts[2].split('.');
  const s = parseInt(secStr, 10);
  const cs = parseInt(csStr ?? '0', 10);
  return ((h * 3600 + m * 60 + s) * 100 + cs) * 10;
}

// ─── ASS Dialogue event ────────────────────────────────────────────────────────

interface AssEvent {
  startMs: number;
  startAss: string;
  endAss: string;
  style: string;
  text: string;
}

// ─── SRT parser → AssEvents ────────────────────────────────────────────────────

/**
 * Parse a bilingual or single-language SRT into ASS events.
 * Chinese lines → Default style, foreign lines → DefaultEN style.
 */
function srtToAssEvents(srt: string): AssEvent[] {
  const normalized = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const events: AssEvent[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    if (!/^\d+$/.test(lines[0].trim())) continue;

    const tsParts = lines[1].split('-->');
    if (tsParts.length !== 2) continue;

    const startAss = srtTimeToAss(tsParts[0].trim());
    const endAss = srtTimeToAss(tsParts[1].trim());
    const startMs = assTimeToMs(startAss);
    const contentLines = lines.slice(2).filter((l) => l.trim() !== '');

    const chLines = contentLines.filter((l) => containsChinese(l));
    const foLines = contentLines.filter((l) => !containsChinese(l));

    if (chLines.length > 0) {
      events.push({ startMs, startAss, endAss, style: 'Default', text: chLines.join('\\N') });
    }
    if (foLines.length > 0) {
      events.push({ startMs, startAss, endAss, style: 'DefaultEN', text: foLines.join('\\N') });
    }
  }

  return events;
}

// ─── ASS parser → AssEvents ────────────────────────────────────────────────────

/**
 * Parse an existing ASS file's [Events] section into AssEvents,
 * reassigning styles based on whether the dialogue text contains Chinese.
 */
function assToAssEvents(ass: string): AssEvent[] {
  const events: AssEvent[] = [];
  let inEvents = false;

  for (const rawLine of ass.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.toLowerCase() === '[events]') { inEvents = true; continue; }
    if (line.startsWith('[') && line.endsWith(']')) { inEvents = false; continue; }
    if (!inEvents) continue;
    if (!line.startsWith('Dialogue:')) continue;

    // Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    const afterColon = line.slice('Dialogue:'.length).trimStart();
    const parts = afterColon.split(',');
    if (parts.length < 10) continue;

    const startAss = parts[1].trim();
    const endAss = parts[2].trim();
    // Text is everything after the 9th comma
    const text = parts.slice(9).join(',');
    const style = containsChinese(text) ? 'Default' : 'DefaultEN';
    const startMs = assTimeToMs(startAss);

    events.push({ startMs, startAss, endAss, style, text });
  }

  return events;
}

// ─── Full ASS file builder ─────────────────────────────────────────────────────

function buildAssFile(
  events: AssEvent[],
  width: number,
  height: number,
  title: string,
  grouped: boolean,
): string {
  let sorted: AssEvent[];
  if (grouped) {
    const byTime = (a: AssEvent, b: AssEvent) => a.startMs - b.startMs;
    const chinese = events.filter((e) => e.style === 'Default').sort(byTime);
    const foreign = events.filter((e) => e.style === 'DefaultEN').sort(byTime);
    const others  = events.filter((e) => e.style !== 'Default' && e.style !== 'DefaultEN').sort(byTime);
    sorted = [...chinese, ...foreign, ...others];
  } else {
    sorted = [...events].sort((a, b) => a.startMs - b.startMs);
  }

  const scriptInfo = [
    '[Script Info]',
    `; Generated by qafoneTools`,
    `Title: ${title}`,
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
  ].join('\n');

  const stylesBlock = `[V4+ Styles]\n${getStylesBlock(width, height)}`;

  const eventsHeader =
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';
  const dialogueLines = sorted.map(
    (ev) => `Dialogue: 0,${ev.startAss},${ev.endAss},${ev.style},,0,0,0,,${ev.text}`,
  );
  const eventsBlock = `[Events]\n${eventsHeader}\n${dialogueLines.join('\n')}`;

  return `${scriptInfo}\n\n${stylesBlock}\n\n${eventsBlock}\n`;
}

// ─── Tauri bridges ─────────────────────────────────────────────────────────────

async function tauriReadTextFile(path: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_text_file', { path });
}

async function tauriGetVideoResolution(
  path: string,
): Promise<{ width: number; height: number }> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<{ width: number; height: number }>('get_video_resolution', { path });
}

async function pickSubtitleFile(): Promise<{ path: string; name: string } | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: false,
    filters: [{ name: 'Subtitle', extensions: ['srt', 'ass'] }],
  });
  if (typeof result === 'string' && result) {
    const name = result.replace(/\\/g, '/').split('/').pop() ?? result;
    return { path: result, name };
  }
  return null;
}

async function pickVideoFile(): Promise<{ path: string; name: string } | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: false,
    filters: [
      { name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'ts', 'wmv', 'm4v', 'webm'] },
    ],
  });
  if (typeof result === 'string' && result) {
    const name = result.replace(/\\/g, '/').split('/').pop() ?? result;
    return { path: result, name };
  }
  return null;
}

async function exportAss(content: string, defaultName: string): Promise<void> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');
  const path = await save({
    defaultPath: defaultName,
    filters: [
      { name: 'ASS Subtitle', extensions: ['ass'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!path) return;
  await invoke('save_text_file', { path, content });
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SubFile {
  name: string;
  path: string | null; // path in Tauri mode; null in browser mode
  content: string;
  isBilingual: boolean;
}

type ResolutionPreset = '480p' | '720p' | '1080p' | 'custom';

const PRESET_RES: Record<Exclude<ResolutionPreset, 'custom'>, { w: number; h: number }> = {
  '480p': { w: 854, h: 480 },
  '720p': { w: 1280, h: 720 },
  '1080p': { w: 1920, h: 1080 },
};

// ─── Main component ────────────────────────────────────────────────────────────

export default function AssFormatterPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const af = t.assFormatter;
  const ep = t.effectsPage;

  // ── State ──────────────────────────────────────────────────────────────────
  const [subFiles, setSubFiles] = useState<SubFile[]>([]);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);

  const [preset, setPreset] = useState<ResolutionPreset>('1080p');
  const [manualW, setManualW] = useState('1920');
  const [manualH, setManualH] = useState('1080');
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);

  const [assOutput, setAssOutput] = useState('');
  const [convertError, setConvertError] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<'grouped' | 'interleaved'>('grouped');

  const [subDragging, setSubDragging] = useState(false);
  const [vidDragging, setVidDragging] = useState(false);

  const subInputRef = useRef<HTMLInputElement>(null);
  const vidInputRef = useRef<HTMLInputElement>(null);
  const locationPathRef = useRef('/effects/ass-formatter');

  // Effective resolution
  const effectiveRes = useCallback((): { w: number; h: number } | null => {
    if (preset !== 'custom') return { w: PRESET_RES[preset].w, h: PRESET_RES[preset].h };
    const w = parseInt(manualW, 10);
    const h = parseInt(manualH, 10);
    if (!w || !h || w <= 0 || h <= 0) return null;
    return { w, h };
  }, [preset, manualW, manualH]);

  // ── Tauri drag-drop listener ───────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;

    (async () => {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      unlisten = await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
        if (locationPathRef.current !== '/effects/ass-formatter') return;
        const { type } = event.payload;
        if (type === 'leave') {
          setSubDragging(false);
          setVidDragging(false);
          return;
        }
        if (type !== 'drop' || !('paths' in event.payload)) return;

        setSubDragging(false);
        setVidDragging(false);

        const paths: string[] = event.payload.paths;
        const subExts = ['.srt', '.ass'];
        const vidExts = ['.mp4', '.mkv', '.mov', '.avi', '.ts', '.wmv', '.m4v', '.webm'];

        for (const p of paths) {
          const lower = p.toLowerCase();
          const name = p.replace(/\\/g, '/').split('/').pop() ?? p;

          if (subExts.some((ext) => lower.endsWith(ext))) {
            try {
              const content = await tauriReadTextFile(p);
              const isBilingual = detectBilingual(content, name);
              setSubFiles((prev) =>
                prev.length < 2 ? [...prev, { name, path: p, content, isBilingual }] : prev,
              );
            } catch { /* ignore unreadable files */ }
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

  // ── Subtitle file handlers ─────────────────────────────────────────────────

  const handleSubBrowse = useCallback(async () => {
    if (subFiles.length >= 2) return;
    if (isTauri()) {
      const picked = await pickSubtitleFile();
      if (!picked) return;
      try {
        const content = await tauriReadTextFile(picked.path);
        const isBilingual = detectBilingual(content, picked.name);
        setSubFiles((prev) =>
          prev.length < 2 ? [...prev, { name: picked.name, path: picked.path, content, isBilingual }] : prev,
        );
      } catch { /* ignore */ }
    } else {
      subInputRef.current?.click();
    }
  }, [subFiles.length]);

  const handleSubInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const isBilingual = detectBilingual(content, file.name);
      setSubFiles((prev) =>
        prev.length < 2 ? [...prev, { name: file.name, path: null, content, isBilingual }] : prev,
      );
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }, []);

  const handleSubDragOver = useCallback((e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    setSubDragging(true);
  }, []);
  const handleSubDragLeave = useCallback(() => { if (!isTauri()) setSubDragging(false); }, []);
  const handleSubDrop = useCallback((e: React.DragEvent) => {
    if (isTauri()) return;
    e.preventDefault();
    setSubDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const isBilingual = detectBilingual(content, file.name);
      setSubFiles((prev) =>
        prev.length < 2 ? [...prev, { name: file.name, path: null, content, isBilingual }] : prev,
      );
    };
    reader.readAsText(file, 'utf-8');
  }, []);

  const removeSubFile = useCallback((index: number) => {
    setSubFiles((prev) => prev.filter((_, i) => i !== index));
    setAssOutput('');
  }, []);

  // ── Video file handlers ────────────────────────────────────────────────────

  const handleVidBrowse = useCallback(async () => {
    if (isTauri()) {
      const picked = await pickVideoFile();
      if (picked) {
        setVideoPath(picked.path);
        setVideoName(picked.name);
        setDetectError(null);
      }
    } else {
      vidInputRef.current?.click();
    }
  }, []);

  const handleVidInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setVideoName(file.name); setVideoPath(null); }
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
    if (file) { setVideoName(file.name); setVideoPath(null); }
  }, []);

  // ── Resolution detection ───────────────────────────────────────────────────

  const handleDetectResolution = useCallback(async () => {
    if (!videoPath) return;
    if (!isTauri()) { setDetectError(af.ffmpegRequired); return; }
    setDetecting(true);
    setDetectError(null);
    try {
      const res = await tauriGetVideoResolution(videoPath);
      setManualW(String(res.width));
      setManualH(String(res.height));
      // Try to match a preset
      if (res.height === 1080) setPreset('1080p');
      else if (res.height === 720) setPreset('720p');
      else if (res.height === 480) setPreset('480p');
      else setPreset('custom');
    } catch (err) {
      setDetectError(String(err));
    } finally {
      setDetecting(false);
    }
  }, [videoPath, af.ffmpegRequired]);

  // ── Preset change side effects ─────────────────────────────────────────────

  const handlePresetChange = useCallback((p: ResolutionPreset) => {
    setPreset(p);
    if (p !== 'custom') {
      setManualW(String(PRESET_RES[p].w));
      setManualH(String(PRESET_RES[p].h));
    }
  }, []);

  // ── Conversion ────────────────────────────────────────────────────────────

  const handleConvert = useCallback(() => {
    setConvertError(null);

    if (subFiles.length === 0) { setConvertError(af.noSubtitleFile); return; }

    const res = effectiveRes();
    if (!res) { setConvertError(af.noResolution); return; }

    const allEvents: AssEvent[] = [];

    for (const sf of subFiles) {
      const lower = sf.name.toLowerCase();
      if (lower.endsWith('.ass')) {
        allEvents.push(...assToAssEvents(sf.content));
      } else {
        allEvents.push(...srtToAssEvents(sf.content));
      }
    }

    const title = subFiles[0].name.replace(/\.[^.]+$/, '');
    const ass = buildAssFile(allEvents, res.w, res.h, title, layoutMode === 'grouped');
    setAssOutput(ass);
  }, [subFiles, effectiveRes, layoutMode, af]);

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    if (!assOutput) return;
    const baseName = subFiles[0]?.name.replace(/\.[^.]+$/, '') ?? 'subtitle';
    await exportAss(assOutput, `${baseName}.ass`);
  }, [assOutput, subFiles]);

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/effects')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-base font-semibold">{ep.assFormatterTitle}</h1>
          <p className="text-xs text-muted-foreground">{ep.assFormatterDesc}</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
        {/* ── Row 1: file inputs ─────────────────────────────────────────── */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Subtitle dropzone */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{af.subtitleFiles}</p>

            {/* File list */}
            {subFiles.map((sf, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-xs text-foreground">{sf.name}</span>
                {sf.isBilingual && (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                    {af.bilingualDetected}
                  </span>
                )}
                <button
                  onClick={() => removeSubFile(idx)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {/* Dropzone (shown when < 2 files) */}
            {subFiles.length < 2 && (
              <div
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 transition-colors',
                  subDragging
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-accent/40',
                )}
                onDragOver={handleSubDragOver}
                onDragLeave={handleSubDragLeave}
                onDrop={handleSubDrop}
                onClick={handleSubBrowse}
              >
                <input
                  ref={subInputRef}
                  type="file"
                  accept=".srt,.ass"
                  className="hidden"
                  onChange={handleSubInputChange}
                />
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="text-center text-xs text-muted-foreground">
                  {subFiles.length === 0 ? af.subtitleDropzone : af.addMore}
                  <br />
                  <span className="text-[11px]">{af.subtitleDropzoneHint}</span>
                </p>
              </div>
            )}
          </div>

          {/* Video dropzone */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{af.videoFile}</p>
            <div
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 transition-colors',
                vidDragging
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50 hover:bg-accent/40',
              )}
              onDragOver={handleVidDragOver}
              onDragLeave={handleVidDragLeave}
              onDrop={handleVidDrop}
              onClick={handleVidBrowse}
            >
              <input
                ref={vidInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleVidInputChange}
              />
              <Film className="h-8 w-8 text-muted-foreground" />
              <p className="text-center text-xs text-muted-foreground">
                {videoName ?? af.videoDropzone}
                {!videoName && <><br /><span className="text-[11px]">{af.videoDropzoneHint}</span></>}
              </p>
            </div>
            {videoPath && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={detecting}
                onClick={handleDetectResolution}
              >
                <MonitorPlay className="mr-2 h-4 w-4" />
                {detecting ? af.detecting : af.detectResolution}
              </Button>
            )}
            {detectError && (
              <p className="text-xs text-destructive">{detectError}</p>
            )}
          </div>
        </div>

        {/* ── Row 2: resolution settings ─────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-sm font-medium">{af.resolution}</p>

          {/* Preset buttons */}
          <div className="mb-3 flex flex-wrap gap-2">
            {(['480p', '720p', '1080p', 'custom'] as ResolutionPreset[]).map((p) => (
              <button
                key={p}
                onClick={() => handlePresetChange(p)}
                className={cn(
                  'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                  preset === p
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                {p === '480p'
                  ? af.preset480p
                  : p === '720p'
                  ? af.preset720p
                  : p === '1080p'
                  ? af.preset1080p
                  : af.presetCustom}
              </button>
            ))}
          </div>

          {/* Manual inputs (always visible; driven by preset or detection) */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {af.width}
              <input
                type="number"
                min={1}
                value={manualW}
                onChange={(e) => { setManualW(e.target.value); setPreset('custom'); }}
                className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </label>
            <span className="text-xs text-muted-foreground">×</span>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {af.height}
              <input
                type="number"
                min={1}
                value={manualH}
                onChange={(e) => { setManualH(e.target.value); setPreset('custom'); }}
                className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </label>
          </div>
        </div>

        {/* ── Row 3: Layout mode toggle ──────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{af.layoutMode}</p>
          <div className="flex gap-2">
            {(['grouped', 'interleaved'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setLayoutMode(mode)}
                title={mode === 'grouped' ? af.layoutGroupedDesc : af.layoutInterleavedDesc}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors text-left',
                  layoutMode === mode
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                <span className="block">{mode === 'grouped' ? af.layoutGrouped : af.layoutInterleaved}</span>
                <span className="block text-[10px] opacity-70 mt-0.5">
                  {mode === 'grouped' ? af.layoutGroupedDesc : af.layoutInterleavedDesc}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Row 4: Convert button + error ─────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <Button
            className="w-full"
            disabled={subFiles.length === 0}
            onClick={handleConvert}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            {af.convert}
          </Button>
          {convertError && <p className="text-xs text-destructive">{convertError}</p>}
        </div>

        {/* ── Row 5: Preview textarea ───────────────────────────────────── */}
        {assOutput && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{af.preview}</p>
            <textarea
              className={cn(
                'min-h-[300px] resize-y rounded-lg border border-border bg-card px-3 py-2',
                'font-mono text-xs leading-relaxed text-foreground',
                'focus:outline-none focus:ring-2 focus:ring-primary/50',
              )}
              value={assOutput}
              onChange={(e) => setAssOutput(e.target.value)}
            />
            <Button variant="outline" className="w-full" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              {af.export}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
