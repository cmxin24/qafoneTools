import { forwardRef } from 'react';
import { useI18n } from '@/i18n';

interface SubtitleEntryContextMenuProps {
  x: number;
  y: number;
  onMergeWithPrev: () => void;
  onMergeWithNext: () => void;
  onInsertBefore: () => void;
  onInsertAfter: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export const SubtitleEntryContextMenu = forwardRef<HTMLDivElement, SubtitleEntryContextMenuProps>(
  function SubtitleEntryContextMenu({
    x,
    y,
    onMergeWithPrev,
    onMergeWithNext,
    onInsertBefore,
    onInsertAfter,
    onSplit,
    onDelete,
    onClose,
  }, ref) {
    const { t } = useI18n();
    const left = typeof window === 'undefined' ? x : Math.min(x, window.innerWidth - 220);
    const top = typeof window === 'undefined' ? y : Math.min(y, window.innerHeight - 260);

    const run = (action: () => void) => {
      action();
      onClose();
    };

    return (
      <div
        ref={ref}
        className="fixed z-50 min-w-[200px] rounded-md border border-border bg-card py-1 text-sm shadow-lg"
        style={{ left: Math.max(8, left), top: Math.max(8, top) }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          className="w-full px-3 py-1.5 text-left transition-colors hover:bg-accent"
          onClick={() => run(onMergeWithPrev)}
        >
          {t.translationPage.mergePrev}
        </button>
        <button
          className="w-full px-3 py-1.5 text-left transition-colors hover:bg-accent"
          onClick={() => run(onMergeWithNext)}
        >
          {t.translationPage.mergeNext}
        </button>
        <div className="my-1 h-px bg-border" />
        <button
          className="w-full px-3 py-1.5 text-left transition-colors hover:bg-accent"
          onClick={() => run(onInsertBefore)}
        >
          {t.translationPage.insertBlankBefore}
        </button>
        <button
          className="w-full px-3 py-1.5 text-left transition-colors hover:bg-accent"
          onClick={() => run(onInsertAfter)}
        >
          {t.translationPage.insertBlankAfter}
        </button>
        <button
          className="w-full px-3 py-1.5 text-left transition-colors hover:bg-accent"
          onClick={() => run(onSplit)}
        >
          {t.translationPage.splitSubtitle}
        </button>
        <div className="my-1 h-px bg-border" />
        <button
          className="w-full px-3 py-1.5 text-left text-destructive transition-colors hover:bg-destructive/10"
          onClick={() => run(onDelete)}
        >
          {t.translationPage.deleteSubtitle}
        </button>
      </div>
    );
  },
);
