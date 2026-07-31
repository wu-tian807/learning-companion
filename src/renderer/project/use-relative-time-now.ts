import { useEffect, useState } from 'react';

const RELATIVE_TIME_REFRESH_INTERVAL = 60_000;

export function useRelativeTimeNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, RELATIVE_TIME_REFRESH_INTERVAL);

    return () => window.clearInterval(interval);
  }, []);

  return now;
}
