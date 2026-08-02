import { useEffect } from 'react';
import { activeSpaceId } from '@/lib/api';

export function useLiveRefresh(onRefresh: () => void) {
  useEffect(() => {
    const spaceId = activeSpaceId();
    const stream = new EventSource(`/api/events${spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ''}`);
    const refresh = () => onRefresh();
    stream.addEventListener('data-changed', refresh);
    stream.addEventListener('response', refresh);
    stream.addEventListener('ai-job', refresh);
    stream.addEventListener('campaign', refresh);
    stream.addEventListener('knowledge-base', refresh);
    stream.addEventListener('knowledge-job', refresh);
    stream.addEventListener('knowledge-indexing-job', refresh);
    return () => stream.close();
  }, [onRefresh]);
}
