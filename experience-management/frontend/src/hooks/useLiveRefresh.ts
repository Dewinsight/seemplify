import { useEffect } from 'react';

export function useLiveRefresh(onRefresh: () => void) {
  useEffect(() => {
    const stream = new EventSource('/api/events');
    const refresh = () => onRefresh();
    stream.addEventListener('data-changed', refresh);
    stream.addEventListener('response', refresh);
    stream.addEventListener('ai-job', refresh);
    stream.addEventListener('campaign', refresh);
    return () => stream.close();
  }, [onRefresh]);
}
