import type { SrtEntry } from '@/components/WaveformDisplay';

export type { SrtEntry };

export type SubtitleMode = 'original' | 'translated' | 'both' | 'none';
export type FFmpegStatus = 'checking' | 'available' | 'not-found' | 'downloading';
export type WaveformStatus = 'idle' | 'loading' | 'ready' | 'error';

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const FRAME_MS = 33;
export const SPLIT_PREFIX = '【已拆】';

export function srtTimeToMs(t: string): number {
  const parts = t.replace(',', '.').split(':');
  const secMs = parts[2].split('.');
  return (
    parseInt(parts[0]) * 3600000 +
    parseInt(parts[1]) * 60000 +
    parseInt(secMs[0]) * 1000 +
    parseInt((secMs[1] || '0').padEnd(3, '0').slice(0, 3))
  );
}

export function msToSrtTime(ms: number): string {
  const c = Math.max(0, Math.round(ms));
  const h = Math.floor(c / 3600000);
  const m = Math.floor((c % 3600000) / 60000);
  const s = Math.floor((c % 60000) / 1000);
  const mil = c % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mil).padStart(3, '0')}`;
}

export function formatTimecode(ms: number): string {
  const c = Math.max(0, ms);
  const m = Math.floor(c / 60000);
  const s = Math.floor((c % 60000) / 1000);
  const cs = Math.floor((c % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function hasCjk(s: string): boolean {
  return /[\u4E00-\u9FFF\u3400-\u4DBF]/u.test(s);
}

export function splitBilingual(bodyLines: string[]): { original: string; translated: string } {
  const nonEmpty = bodyLines.filter((line) => line.trim() !== '');
  if (nonEmpty.length === 0) return { original: '', translated: '' };
  if (nonEmpty.length === 1) return { original: nonEmpty[0], translated: '' };

  const originalLines: string[] = [];
  const translatedLines: string[] = [];
  for (const line of nonEmpty) {
    if (hasCjk(line)) translatedLines.push(line);
    else originalLines.push(line);
  }

  if (originalLines.length === 0 || translatedLines.length === 0) {
    return { original: nonEmpty.join('\n'), translated: '' };
  }
  return { original: originalLines.join('\n'), translated: translatedLines.join('\n') };
}

export function parseSrt(content: string): SrtEntry[] {
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

export function exportSrt(entries: SrtEntry[], mode: 'original' | 'translation' | 'bilingual'): string {
  return entries
    .map((entry) => {
      const text =
        mode === 'original'
          ? entry.originalText
          : mode === 'translation'
          ? entry.translatedText || entry.originalText
          : `${entry.originalText}\n${entry.translatedText || ''}`;
      return `${entry.index}\n${msToSrtTime(entry.startMs)} --> ${msToSrtTime(entry.endMs)}\n${text}`;
    })
    .join('\n\n');
}

export function downloadFile(content: string, filename: string, type = 'text/plain;charset=utf-8') {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    void (async () => {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { invoke } = await import('@tauri-apps/api/core');
      const extension = filename.split('.').pop()?.toLowerCase() || 'txt';
      const path = await save({
        defaultPath: filename,
        filters: [
          { name: extension.toUpperCase(), extensions: [extension] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (!path) return;
      await invoke('save_text_file', { path, content });
    })().catch((error) => {
      console.error('Failed to save file:', error);
    });
    return;
  }

  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function joinSubtitleText(a: string, b: string): string {
  return (
    a.trimEnd() +
    (!a.trimEnd().endsWith(' ') && !b.trimStart().startsWith(' ') ? ' ' : '') +
    b.trimStart()
  );
}

export function renumberSubtitleEntries<T extends SrtEntry>(entries: T[]): T[] {
  return entries.map((entry, i) => ({ ...entry, index: i + 1 }));
}

export interface SubtitleTextSplit {
  first: string;
  second: string;
  ratio: number;
  didSplit: boolean;
}

function textWeight(text: string): number {
  return Math.max(1, text.replace(/\s/g, '').length);
}

export function splitSubtitleText(text: string): SubtitleTextSplit {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 1) {
    const first = lines[0];
    const second = lines.slice(1).join('\n');
    const firstWeight = textWeight(first);
    const totalWeight = firstWeight + textWeight(second);
    return { first, second, ratio: firstWeight / totalWeight, didSplit: true };
  }

  const sentenceEnders = new Set(['。', '！', '？', '!', '?', '.']);
  for (let i = 0; i < normalized.length; i++) {
    if (!sentenceEnders.has(normalized[i])) continue;
    const first = normalized.slice(0, i + 1);
    const second = normalized.slice(i + 1).trimStart();
    if (!second.trim()) continue;
    const firstWeight = textWeight(first);
    const totalWeight = firstWeight + textWeight(second);
    return { first, second, ratio: firstWeight / totalWeight, didSplit: true };
  }

  return { first: normalized, second: '', ratio: 0.5, didSplit: false };
}

export function ensureSplitPrefix(text: string): string {
  return text.startsWith(SPLIT_PREFIX) ? text : `${SPLIT_PREFIX}${text}`;
}

export function insertSubtitleEntry<T extends SrtEntry>(
  entries: T[],
  atMs: number,
  createEntry?: (startMs: number, endMs: number) => T,
): T[] {
  const nextEntry = entries.find((entry) => entry.startMs > atMs);
  const maxEndMs = nextEntry ? nextEntry.startMs - FRAME_MS : atMs + 2000;
  const endMs = Math.min(atMs + 2000, maxEndMs);
  if (endMs < atMs + FRAME_MS) return entries;

  const entry = createEntry
    ? createEntry(atMs, endMs)
    : ({
        index: 0,
        startMs: atMs,
        endMs,
        originalText: '',
        translatedText: '',
      } as T);
  const idx = entries.findIndex((item) => item.startMs > atMs);
  return renumberSubtitleEntries(idx >= 0 ? [...entries.slice(0, idx), entry, ...entries.slice(idx)] : [...entries, entry]);
}

export function insertBlankSubtitleEntry<T extends SrtEntry>(
  entries: T[],
  idx: number,
  side: 'before' | 'after',
  mediaDurationMs: number,
  createEntry?: (startMs: number, endMs: number) => T,
): T[] | null {
  const current = entries[idx];
  if (!current) return null;

  let startMs: number;
  let endMs: number;
  let insertIdx: number;

  if (side === 'before') {
    endMs = current.startMs - FRAME_MS;
    const minStartMs = idx > 0 ? entries[idx - 1].endMs + FRAME_MS : 0;
    startMs = Math.max(minStartMs, endMs - 2000);
    insertIdx = idx;
  } else {
    startMs = current.endMs + FRAME_MS;
    const maxEndMs = idx < entries.length - 1
      ? entries[idx + 1].startMs - FRAME_MS
      : mediaDurationMs > 0
      ? mediaDurationMs
      : startMs + 2000;
    endMs = Math.min(startMs + 2000, maxEndMs);
    insertIdx = idx + 1;
  }

  if (endMs - startMs < FRAME_MS) return null;

  const entry = createEntry
    ? createEntry(startMs, endMs)
    : ({
        index: 0,
        startMs,
        endMs,
        originalText: '',
        translatedText: '',
      } as T);

  return renumberSubtitleEntries([...entries.slice(0, insertIdx), entry, ...entries.slice(insertIdx)]);
}

export function deleteSubtitleEntry<T extends SrtEntry>(entries: T[], idx: number): T[] {
  return renumberSubtitleEntries(entries.filter((_, i) => i !== idx));
}

export function mergeSubtitleEntries<T extends SrtEntry>(
  entries: T[],
  idx: number,
  dir: 'prev' | 'next',
  mergeExtra?: (left: T, right: T) => Partial<T>,
): T[] {
  const a = dir === 'prev' ? idx - 1 : idx;
  const b = a + 1;
  if (a < 0 || b >= entries.length) return entries;

  const left = entries[a];
  const right = entries[b];
  const merged: T = {
    ...left,
    index: left.index,
    startMs: left.startMs,
    endMs: right.endMs,
    originalText: joinSubtitleText(left.originalText, right.originalText),
    translatedText: joinSubtitleText(left.translatedText, right.translatedText),
    ...(mergeExtra?.(left, right) ?? {}),
  };

  return renumberSubtitleEntries([...entries.slice(0, a), merged, ...entries.slice(b + 1)]);
}

export function splitSubtitleEntry<T extends SrtEntry>(
  entries: T[],
  idx: number,
  splitExtra?: (entry: T) => [Partial<T>, Partial<T>],
): T[] {
  const entry = entries[idx];
  if (!entry) return entries;

  const duration = Math.max(0, entry.endMs - entry.startMs);
  const originalSplit = splitSubtitleText(entry.originalText);
  const translatedSplit = splitSubtitleText(entry.translatedText);
  const splitOffset = Math.round(duration * originalSplit.ratio);
  const canKeepFrameGap = duration >= FRAME_MS * 2;
  const splitMs = canKeepFrameGap
    ? Math.max(entry.startMs + FRAME_MS, Math.min(entry.endMs - FRAME_MS, entry.startMs + splitOffset))
    : entry.startMs + Math.floor(duration / 2);
  const secondStartMs = canKeepFrameGap ? Math.min(entry.endMs, splitMs + FRAME_MS) : splitMs;
  const [firstExtra, secondExtra] = splitExtra?.(entry) ?? [{}, {}];

  const first: T = {
    ...entry,
    endMs: splitMs,
    originalText: ensureSplitPrefix(originalSplit.first),
    translatedText: translatedSplit.first,
    ...firstExtra,
  };
  const second: T = {
    ...entry,
    startMs: secondStartMs,
    originalText: ensureSplitPrefix(originalSplit.second),
    translatedText: translatedSplit.second,
    ...secondExtra,
  };

  return renumberSubtitleEntries([...entries.slice(0, idx), first, second, ...entries.slice(idx + 1)]);
}
