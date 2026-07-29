'use client';

import { useEffect, type RefObject } from 'react';

/** Closes a dropdown/popover when the user clicks or taps outside `ref`'s element. */
export function useOnClickOutside(ref: RefObject<HTMLElement>, handler: () => void): void {
  useEffect(() => {
    function listener(event: MouseEvent | TouchEvent): void {
      const target = event.target as Node;
      if (!ref.current || ref.current.contains(target)) return;
      handler();
    }
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
}
