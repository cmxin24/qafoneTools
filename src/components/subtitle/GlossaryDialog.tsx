import { useEffect, useRef, type ChangeEvent } from 'react';
import { BookOpen, Download, Plus, Trash2, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { downloadFile } from './subtitleWorkspace';

export interface GlossaryEntry {
  id: string;
  original: string;
  translation: string;
  notes: string;
}

export function isNonEmptyGlossaryEntry(row: GlossaryEntry): boolean {
  return row.original.trim() !== '' || row.translation.trim() !== '' || row.notes.trim() !== '';
}

export function countGlossaryEntries(rows: GlossaryEntry[]): number {
  return rows.filter(isNonEmptyGlossaryEntry).length;
}

export function downloadGlossary(
  rows: GlossaryEntry[],
  labels: { original: string; translation: string; notes: string },
) {
  const header = `${labels.original}\t${labels.translation}\t${labels.notes}`;
  const body = rows.filter(isNonEmptyGlossaryEntry).map((r) => `${r.original}\t${r.translation}\t${r.notes}`).join('\n');
  downloadFile(`${header}\n${body}`, 'glossary.txt');
}

export function GlossaryDialog({
  rows,
  onRowsChange,
  onExported,
  onClose,
}: {
  rows: GlossaryEntry[];
  onRowsChange: (rows: GlossaryEntry[]) => void;
  onExported: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tp = t.translationPage;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nonEmptyCount = countGlossaryEntries(rows);

  const addRow = () => {
    onRowsChange([...rows, { id: crypto.randomUUID(), original: '', translation: '', notes: '' }]);
  };

  const deleteRow = (id: string) => {
    onRowsChange(rows.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, field: keyof Omit<GlossaryEntry, 'id'>, value: string) => {
    onRowsChange(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim());
      const firstLine = lines[0] ?? '';
      const hasHeader = firstLine.includes('\t') && !/^[\w\s]+$/.test(firstLine.split('\t')[0]);
      const start = firstLine.startsWith('原文\t') || firstLine.startsWith('Original\t') ? 1 : 0;
      const imported: GlossaryEntry[] = lines.slice(hasHeader ? (start > 0 ? start : 0) : start).map((line) => {
        const parts = line.split('\t');
        return {
          id: crypto.randomUUID(),
          original: parts[0] ?? '',
          translation: parts[1] ?? '',
          notes: parts[2] ?? '',
        };
      });
      onRowsChange(imported);
    });
    e.target.value = '';
  };

  const handleExport = () => {
    downloadGlossary(rows, {
      original: tp.glossaryColOriginal,
      translation: tp.glossaryColTranslation,
      notes: tp.glossaryColNotes,
    });
    onExported();
  };

  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[720px] max-w-[92vw] flex-col rounded-xl border border-border bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{tp.glossaryTitle}</span>
          <div className="flex-1" />
          <input ref={fileInputRef} type="file" accept=".txt" className="sr-only" onChange={handleImport} />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileInputRef.current?.click()}>
            {tp.glossaryImport}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExport} disabled={nonEmptyCount === 0}>
            <Download className="mr-1 h-3 w-3" />{tp.glossaryExport}
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={addRow}>
            <Plus className="mr-1 h-3 w-3" />{tp.glossaryAddRow}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-shrink-0 select-none grid-cols-[1fr_1fr_1fr_32px] border-b border-border bg-muted/30 text-xs text-muted-foreground">
          <div className="border-r border-border/40 px-3 py-2 font-medium">{tp.glossaryColOriginal}</div>
          <div className="border-r border-border/40 px-3 py-2 font-medium">{tp.glossaryColTranslation}</div>
          <div className="border-r border-border/40 px-3 py-2 font-medium">{tp.glossaryColNotes}</div>
          <div />
        </div>

        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-muted-foreground">
              <BookOpen className="h-8 w-8 opacity-25" />
              <p className="text-sm">{tp.glossaryEmpty}</p>
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="group grid grid-cols-[1fr_1fr_1fr_32px] border-b border-border/40 hover:bg-muted/10"
              >
                <input
                  value={row.original}
                  onChange={(e) => updateRow(row.id, 'original', e.target.value)}
                  className="border-r border-border/30 bg-transparent px-3 py-1.5 text-sm focus:bg-muted/20 focus:outline-none"
                  placeholder={tp.glossaryPlaceholderOriginal}
                />
                <input
                  value={row.translation}
                  onChange={(e) => updateRow(row.id, 'translation', e.target.value)}
                  className="border-r border-border/30 bg-transparent px-3 py-1.5 text-sm focus:bg-muted/20 focus:outline-none"
                  placeholder={tp.glossaryPlaceholderTranslation}
                />
                <input
                  value={row.notes}
                  onChange={(e) => updateRow(row.id, 'notes', e.target.value)}
                  className="border-r border-border/30 bg-transparent px-3 py-1.5 text-sm focus:bg-muted/20 focus:outline-none"
                  placeholder={tp.glossaryPlaceholderNotes}
                />
                <button
                  type="button"
                  onClick={() => deleteRow(row.id)}
                  className="flex items-center justify-center opacity-0 transition-all hover:!opacity-100 hover:text-destructive group-hover:opacity-40"
                  title={tp.glossaryDeleteRow}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-shrink-0 items-center border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
          {tp.glossaryCount.replace('{count}', String(nonEmptyCount))}
        </div>
      </div>
    </div>
  );
}
