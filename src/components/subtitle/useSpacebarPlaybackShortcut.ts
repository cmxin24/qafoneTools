import { useEffect } from 'react';

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"]');
}

export function useSpacebarPlaybackShortcut(onTogglePlayback: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'Space' || isTextInputTarget(event.target)) return;
      event.preventDefault();
      onTogglePlayback();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onTogglePlayback]);
}
