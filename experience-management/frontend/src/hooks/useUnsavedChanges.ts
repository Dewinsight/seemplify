import { useEffect, useRef } from 'react';
import { clearUnsavedChangeSource, setUnsavedChangeSource, shouldBlockBeforeUnload } from '@/lib/unsavedChanges';

export function useUnsavedChanges(dirty: boolean) {
  const source = useRef(Symbol('unsaved-changes'));

  useEffect(() => {
    setUnsavedChangeSource(source.current, dirty);
    return () => clearUnsavedChangeSource(source.current);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!shouldBlockBeforeUnload()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
