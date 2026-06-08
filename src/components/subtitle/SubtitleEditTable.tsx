import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { MoreVertical } from 'lucide-react';
import { type SrtEntry } from '@/components/WaveformDisplay';
import { autoResize, formatDuration, msToSrtTime } from './subtitleWorkspace';
import { SubtitleEntryContextMenu } from './SubtitleEntryContextMenu';

export interface SubtitleEditColumn<T extends SrtEntry> {
  id: string;
  label: string;
  value: (entry: T) => string;
  onChange?: (idx: number, value: string) => void;
  placeholder?: string;
  tone?: 'default' | 'muted' | 'note';
  cellClassName?: (entry: T, idx: number) => string;
}

interface SubtitleEditTableProps<T extends SrtEntry> {
  entries: T[];
  activeIdx: number;
  columns: SubtitleEditColumn<T>[];
  gridTemplateColumns: string;
  tableMenu: { x: number; y: number; idx: number } | null;
  tableMenuRef: RefObject<HTMLDivElement | null>;
  rowRefs: RefObject<(HTMLDivElement | null)[]>;
  onSetTableMenu: (menu: { x: number; y: number; idx: number } | null) => void;
  onSeek: (time: number) => void;
  onMergeWithPrev: (idx: number) => void;
  onMergeWithNext: (idx: number) => void;
  onInsertBefore: (idx: number) => void;
  onInsertAfter: (idx: number) => void;
  onSplit: (idx: number) => void;
  onDelete: (idx: number) => void;
  rowAction?: (entry: T, idx: number) => ReactNode;
}

export function SubtitleEditTable<T extends SrtEntry>({
  entries,
  activeIdx,
  columns,
  gridTemplateColumns,
  tableMenu,
  tableMenuRef,
  rowRefs,
  onSetTableMenu,
  onSeek,
  onMergeWithPrev,
  onMergeWithNext,
  onInsertBefore,
  onInsertAfter,
  onSplit,
  onDelete,
  rowAction,
}: SubtitleEditTableProps<T>) {
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  useEffect(() => {
    textareaRefs.current.forEach((el) => autoResize(el));
  }, [entries]);

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="sticky top-0 z-30 grid border-b border-border bg-muted text-xs font-medium text-muted-foreground shadow-sm"
          style={{ gridTemplateColumns }}
        >
          {columns.map((column, idx) => (
            <div
              key={column.id}
              className={[
                'px-3 py-1.5',
                idx < columns.length - 1 ? 'border-r border-border/60' : '',
              ].join(' ')}
            >
              {column.label}
            </div>
          ))}
        </div>

        {entries.map((entry, idx) => {
          const isActive = idx === activeIdx;
          return (
            <div
              key={`${entry.index}-${entry.startMs}`}
              ref={(el) => { rowRefs.current[idx] = el; }}
              onClick={() => onSeek(entry.startMs / 1000)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSetTableMenu({ x: e.clientX, y: e.clientY, idx });
              }}
              className={[
                'relative grid scroll-mt-8 cursor-pointer border-b border-border/50 transition-colors',
                isActive ? 'bg-primary/10' : 'hover:bg-muted/20',
              ].join(' ')}
              style={{ gridTemplateColumns }}
            >
              <div
                className="flex items-center gap-1.5 px-2.5 pt-1 pb-0 text-xs text-muted-foreground select-none"
                style={{ gridColumn: `1 / span ${columns.length}` }}
              >
                <span className={`font-semibold ${isActive ? 'text-primary' : 'text-muted-foreground/50'}`}>
                  #{entry.index}
                </span>
                <span className="font-mono">{msToSrtTime(entry.startMs)}</span>
                <span className="opacity-40">→</span>
                <span className="font-mono">{msToSrtTime(entry.endMs)}</span>
                <span className="text-muted-foreground/50">({formatDuration(entry.endMs - entry.startMs)})</span>
                <div className="flex-1" />
                {rowAction?.(entry, idx)}
                <button
                  type="button"
                  className="rounded p-0.5 opacity-40 transition-opacity hover:bg-accent hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    onSetTableMenu({ x: rect.right - 164, y: rect.bottom + 2, idx });
                  }}
                >
                  <MoreVertical className="h-3 w-3" />
                </button>
              </div>

              {columns.map((column, colIdx) => {
                const editable = !!column.onChange;
                const toneClass =
                  column.tone === 'muted'
                    ? 'bg-muted/20 text-muted-foreground'
                    : column.tone === 'note'
                    ? 'focus:border-amber-400/50'
                    : 'focus:border-primary/40';
                return (
                  <div
                    key={column.id}
                    className={[
                      'px-2.5 py-0.5',
                      colIdx < columns.length - 1 ? 'border-r border-border/40' : '',
                      column.cellClassName?.(entry, idx) ?? '',
                    ].join(' ')}
                  >
                    {editable ? (
                      <textarea
                        ref={(el) => {
                          const key = `${column.id}-${idx}`;
                          if (el) {
                            textareaRefs.current.set(key, el);
                            autoResize(el);
                          } else {
                            textareaRefs.current.delete(key);
                          }
                        }}
                        rows={1}
                        value={column.value(entry)}
                        onChange={(e) => {
                          column.onChange?.(idx, e.target.value);
                          autoResize(e.currentTarget);
                        }}
                        onFocus={() => onSeek(entry.startMs / 1000)}
                        placeholder={column.placeholder}
                        className={[
                          'min-h-[24px] w-full resize-none overflow-hidden rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-sm leading-5 outline-none transition-colors focus:bg-background',
                          toneClass,
                        ].join(' ')}
                      />
                    ) : (
                      <div className="min-h-[24px] whitespace-pre-wrap rounded-sm px-1.5 py-0.5 text-sm leading-5 text-muted-foreground">
                        {column.value(entry)}
                      </div>
                    )}
                  </div>
                );
              })}

              {tableMenu?.idx === idx && (
                <SubtitleEntryContextMenu
                  ref={tableMenuRef}
                  x={tableMenu.x}
                  y={tableMenu.y}
                  onMergeWithPrev={() => onMergeWithPrev(idx)}
                  onMergeWithNext={() => onMergeWithNext(idx)}
                  onInsertBefore={() => onInsertBefore(idx)}
                  onInsertAfter={() => onInsertAfter(idx)}
                  onSplit={() => onSplit(idx)}
                  onDelete={() => onDelete(idx)}
                  onClose={() => onSetTableMenu(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
