import { useEffect, useState } from 'react';
import { LinkPreviewResult } from '../types/linkPreview';
import { unfurlLink } from '../services/linkPreview';

export function useLinkPreview(url: string | null) {
  const [data, setData] = useState<LinkPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!url) {
        setData(null);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await unfurlLink(url);
        if (!cancelled) setData(res);
      } catch (e: any) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, loading, error };
}