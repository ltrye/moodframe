import { useCallback, useEffect, useRef, useState } from 'react';
import { toLocalFileUrl } from '../utils/localUrl';

type Job = { cancelled: boolean; run: () => Promise<void> };
const queue: Job[] = [];
let running = 0;
function drain() {
  while (running < 8 && queue.length) {
    const job = queue.shift()!;
    if (job.cancelled) continue;
    running++;
    void job.run().finally(() => { running--; drain(); });
  }
}

/** UI slots stay occupied until IPC finishes, including after unmount. */
export function useThumbnail(filePath: string, rootMargin = '600px 0px') {
  const [result, setResult] = useState<{ path: string; src: string } | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const attach = useCallback((el: HTMLElement | null) => { elRef.current = el; }, []);
  useEffect(() => {
    const element = elRef.current;
    if (!element) return;
    let active = true;
    let job: Job | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      job = { cancelled: false, run: async () => {
        try {
          const path = await window.moodframe.getThumbnail(filePath);
          if (active) setResult({ path: filePath, src: toLocalFileUrl(path) });
        } catch {
          // The original can still be opened if a file is corrupt or unsupported.
        }
      } };
      queue.push(job);
      drain();
    }, { rootMargin });
    observer.observe(element);
    return () => { active = false; observer.disconnect(); if (job) job.cancelled = true; };
  }, [filePath, rootMargin]);
  return { src: result?.path === filePath ? result.src : null, attach };
}
