import { useState, useRef, useCallback } from 'react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowLeft, FileText, SplitSquareHorizontal, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// ─── SRT Parsing Helpers ───────────────────────────────────────────────────────

/** Returns true if the text contains at least one CJK character. */
function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/.test(text);
}

interface SeparatedSrt {
  chinese: string;
  foreign: string;
}

/**
 * Parses a bilingual SRT string and separates each block into
 * a Chinese-only SRT and a foreign-only SRT.
 *
 * Rules:
 *  - Lines containing CJK characters → Chinese track.
 *  - Lines without CJK characters   → Foreign track.
 *  - Blocks with only one language are placed only in that track.
 *  - Block indices are re-numbered from 1 in each output.
 */
function parseBilingualSrt(raw: string): SeparatedSrt {
  // Normalize line-endings, then split into blocks.
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n{2,}/);

  const chineseBlocks: string[] = [];
  const foreignBlocks: string[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    // Validate SRT block structure.
    const indexLine = lines[0].trim();
    const timestampLine = lines[1].trim();
    if (!/^\d+$/.test(indexLine) || !timestampLine.includes('-->')) continue;

    const contentLines = lines.slice(2).filter((l) => l.trim() !== '');
    if (contentLines.length === 0) continue;

    const chLines = contentLines.filter((l) => containsChinese(l));
    const foLines = contentLines.filter((l) => !containsChinese(l));

    if (chLines.length > 0) {
      chineseBlocks.push(`${chineseBlocks.length + 1}\n${timestampLine}\n${chLines.join('\n')}`);
    }
    if (foLines.length > 0) {
      foreignBlocks.push(`${foreignBlocks.length + 1}\n${timestampLine}\n${foLines.join('\n')}`);
    }
  }

  return {
    chinese: chineseBlocks.join('\n\n'),
    foreign: foreignBlocks.join('\n\n'),
  };
}

// ─── Export Helper ─────────────────────────────────────────────────────────────

async function exportSrt(content: string, defaultName: string) {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');
  const path = await save({
    defaultPath: defaultName,
    filters: [
      { name: 'SRT Subtitle', extensions: ['srt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!path) return;
  await invoke('save_text_file', { path, content });
}

// ─── Dropzone Component ────────────────────────────────────────────────────────

interface DropzoneProps {
  onFile: (name: string, content: string) => void;
  fileName: string | null;
  labels: { dropzone: string; dropzoneHint: string; fileSelected: string; noFileSelected: string };
}

function Dropzone({ onFile, fileName, labels }: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback((file: File) => {
    if (!file.name.endsWith('.srt')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      onFile(file.name, content);
    };
    reader.readAsText(file, 'utf-8');
  }, [onFile]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) readFile(file);
      // Reset so the same file can be re-selected.
      e.target.value = '';
    },
    [readFile],
  );

  return (
    <div
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors',
        isDragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-accent/40',
      )}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".srt"
        className="hidden"
        onChange={handleChange}
      />
      <FileText className="h-10 w-10 text-muted-foreground" />
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">
          {fileName ? `${labels.fileSelected}: ${fileName}` : labels.dropzone}
        </p>
        {!fileName && (
          <p className="mt-1 text-xs text-muted-foreground">{labels.dropzoneHint}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function BilingualSeparatorPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bs = t.bilingualSeparator;
  const ep = t.effectsPage;

  const [fileName, setFileName] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState<string>('');
  const [chineseText, setChineseText] = useState<string>('');
  const [foreignText, setForeignText] = useState<string>('');
  const [separated, setSeparated] = useState(false);

  const handleFile = useCallback((name: string, content: string) => {
    setFileName(name);
    setRawContent(content);
    setSeparated(false);
    setChineseText('');
    setForeignText('');
  }, []);

  const handleSeparate = useCallback(() => {
    const result = parseBilingualSrt(rawContent);
    setChineseText(result.chinese);
    setForeignText(result.foreign);
    setSeparated(true);
  }, [rawContent]);

  const baseName = fileName ? fileName.replace(/\.srt$/i, '') : 'subtitle';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigate('/effects')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-base font-semibold">{ep.bilingualSeparatorTitle}</h1>
          <p className="text-xs text-muted-foreground">{ep.bilingualSeparatorDesc}</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
        {/* Dropzone + Separate button */}
        <div className="flex flex-col gap-3">
          <Dropzone
            onFile={handleFile}
            fileName={fileName}
            labels={{
              dropzone: bs.dropzone,
              dropzoneHint: bs.dropzoneHint,
              fileSelected: bs.fileSelected,
              noFileSelected: bs.noFileSelected,
            }}
          />
          <Button
            className="w-full"
            disabled={!rawContent}
            onClick={handleSeparate}
          >
            <SplitSquareHorizontal className="mr-2 h-4 w-4" />
            {bs.separate}
          </Button>
        </div>

        {/* Result text areas */}
        {separated && (
          <div className="flex flex-1 gap-4">
            {/* Chinese track */}
            <div className="flex flex-1 flex-col gap-2">
              <p className="text-sm font-medium text-foreground">{bs.chineseSubtitle}</p>
              <textarea
                className={cn(
                  'flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2',
                  'font-mono text-xs leading-relaxed text-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-primary/50',
                  'min-h-[300px]',
                )}
                value={chineseText}
                placeholder={bs.noContent}
                onChange={(e) => setChineseText(e.target.value)}
              />
              <Button
                variant="outline"
                className="w-full"
                disabled={!chineseText.trim()}
                onClick={() => exportSrt(chineseText, `${baseName}_zh.srt`)}
              >
                <Download className="mr-2 h-4 w-4" />
                {bs.exportChinese}
              </Button>
            </div>

            {/* Foreign track */}
            <div className="flex flex-1 flex-col gap-2">
              <p className="text-sm font-medium text-foreground">{bs.foreignSubtitle}</p>
              <textarea
                className={cn(
                  'flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2',
                  'font-mono text-xs leading-relaxed text-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-primary/50',
                  'min-h-[300px]',
                )}
                value={foreignText}
                placeholder={bs.noContent}
                onChange={(e) => setForeignText(e.target.value)}
              />
              <Button
                variant="outline"
                className="w-full"
                disabled={!foreignText.trim()}
                onClick={() => exportSrt(foreignText, `${baseName}_foreign.srt`)}
              >
                <Download className="mr-2 h-4 w-4" />
                {bs.exportForeign}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
