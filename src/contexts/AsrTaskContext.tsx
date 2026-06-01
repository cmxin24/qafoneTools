/**
 * AsrTaskContext — global state for the subtitle extraction task.
 *
 * Keeps extraction status, progress, and results alive across navigation so
 * that switching to another page and back does not lose the ongoing task.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react';

// ─── Shared types (also exported for the SubtitleExtraction page) ────────────

export interface AsrSegment {
  index: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface AsrProgressPayload {
  phase: string;
  /** 0.0 – 1.0 */
  progress: number;
  message: string;
}

export interface TaskFile {
  name: string;
  size: number;
  path: string | null;
  objectUrl: string | null;
}

export type ExtractionStatus = 'idle' | 'extracting' | 'done' | 'error' | 'cancelled';

// ─── Context shape ────────────────────────────────────────────────────────────

interface AsrTaskContextType {
  status: ExtractionStatus;
  progress: AsrProgressPayload | null;
  segments: AsrSegment[];
  error: string | null;
  taskFile: TaskFile | null;
  taskModelId: string;
  startExtraction: (file: TaskFile, modelId: string) => Promise<void>;
  cancelExtraction: () => Promise<void>;
  clearTask: () => void;
  /** Allow page to inject segments loaded from history. */
  setSegments: Dispatch<SetStateAction<AsrSegment[]>>;
  setStatus: Dispatch<SetStateAction<ExtractionStatus>>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── Context ──────────────────────────────────────────────────────────────────

const AsrTaskContext = createContext<AsrTaskContextType>({
  status: 'idle',
  progress: null,
  segments: [],
  error: null,
  taskFile: null,
  taskModelId: '',
  startExtraction: async () => {},
  cancelExtraction: async () => {},
  clearTask: () => {},
  setSegments: () => {},
  setStatus: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AsrTaskProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ExtractionStatus>('idle');
  const [progress, setProgress] = useState<AsrProgressPayload | null>(null);
  const [segments, setSegments] = useState<AsrSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [taskFile, setTaskFile] = useState<TaskFile | null>(null);
  const [taskModelId, setTaskModelId] = useState('');

  // Subscribe to asr-progress events globally so progress is captured even
  // when the SubtitleExtraction page is not mounted.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<AsrProgressPayload>('asr-progress', (ev) => {
        setProgress(ev.payload);
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  const startExtraction = useCallback(
    async (file: TaskFile, modelId: string) => {
      setStatus('extracting');
      setProgress({ phase: 'audio_extract', progress: 0, message: '正在提取音频…' });
      setError(null);
      setSegments([]);
      setTaskFile(file);
      setTaskModelId(modelId);

      if (isTauri() && file.path) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const segs = await invoke<AsrSegment[]>('extract_subtitles', {
            videoPath: file.path,
            modelId,
            language: null,
          });
          setSegments(segs);
          setStatus('done');
          setProgress({
            phase: 'done',
            progress: 1,
            message: `转录完成，共识别 ${segs.length} 条字幕。`,
          });
        } catch (err: unknown) {
          const msg =
            typeof err === 'string'
              ? err
              : ((err as { message?: string })?.message ?? String(err));
          if (msg === '已取消') {
            setStatus('cancelled');
            setProgress({ phase: 'cancelled', progress: 0, message: '转录已取消' });
          } else {
            setError(msg);
            setStatus('error');
            setProgress({ phase: 'error', progress: 0, message: '转录失败' });
          }
        }
      } else {
        // Browser dev-mode mock
        await new Promise((r) => setTimeout(r, 800));
        setProgress({ phase: 'transcribing', progress: 0.3, message: '转录中…' });
        await new Promise((r) => setTimeout(r, 1500));
        setProgress({ phase: 'transcribing', progress: 0.8, message: '转录中… 80%' });
        await new Promise((r) => setTimeout(r, 500));
        const mockSegs: AsrSegment[] = [
          { index: 1, start_ms: 1000,  end_ms: 4500,  text: '大家好，这是一条提取出的字幕。' },
          { index: 2, start_ms: 5000,  end_ms: 9200,  text: '这是第二条字幕块。' },
          { index: 3, start_ms: 10000, end_ms: 15000, text: 'And here is an English subtitle.' },
        ];
        setSegments(mockSegs);
        setStatus('done');
        setProgress({ phase: 'done', progress: 1, message: '转录完成。' });
      }
    },
    [],
  );

  const cancelExtraction = useCallback(async () => {
    if (!isTauri()) {
      setStatus('cancelled');
      setProgress(null);
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('cancel_extraction');
    } catch {
      // Best-effort; the status will be updated when the invoke rejects.
    }
    // The status transitions to 'cancelled' when the extract_subtitles invoke
    // rejects with "已取消". We set it here too as an immediate UI update.
    setStatus('cancelled');
    setProgress({ phase: 'cancelled', progress: 0, message: '正在取消…' });
  }, []);

  const clearTask = useCallback(() => {
    setStatus('idle');
    setProgress(null);
    setSegments([]);
    setError(null);
    setTaskFile(null);
    setTaskModelId('');
  }, []);

  return (
    <AsrTaskContext.Provider
      value={{
        status,
        progress,
        segments,
        error,
        taskFile,
        taskModelId,
        startExtraction,
        cancelExtraction,
        clearTask,
        setSegments,
        setStatus,
      }}
    >
      {children}
    </AsrTaskContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAsrTask() {
  return useContext(AsrTaskContext);
}
