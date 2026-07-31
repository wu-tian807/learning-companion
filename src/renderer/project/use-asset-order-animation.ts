import { useLayoutEffect, useRef } from 'react';

import type { AssetSnapshot } from '../../shared/assets';

interface AssetRowPosition {
  readonly left: number;
  readonly top: number;
}

export function useAssetOrderAnimation(
  assets: readonly AssetSnapshot[],
) {
  const rowsRef = useRef(new Map<string, HTMLDivElement>());
  const previousPositionsRef = useRef(
    new Map<string, AssetRowPosition>(),
  );
  const measuredRef = useRef(false);

  useLayoutEffect(() => {
    const positions = new Map<string, AssetRowPosition>();
    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (const asset of assets) {
      const row = rowsRef.current.get(asset.id);

      if (!row) {
        continue;
      }

      const position = {
        left: row.offsetLeft,
        top: row.offsetTop,
      };
      positions.set(asset.id, position);

      if (!measuredRef.current || reducedMotion) {
        continue;
      }

      const previousPosition = previousPositionsRef.current.get(
        asset.id,
      );

      if (!previousPosition) {
        row.animate(
          [
            {
              opacity: 0,
              transform: 'translate3d(0, -6px, 0) scale(0.985)',
            },
            {
              opacity: 1,
              transform: 'translate3d(0, 0, 0) scale(1)',
            },
          ],
          {
            duration: 180,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          },
        );
        continue;
      }

      const deltaX = previousPosition.left - position.left;
      const deltaY = previousPosition.top - position.top;

      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
        continue;
      }

      row.animate(
        [
          {
            transform: `translate3d(${deltaX}px, ${deltaY}px, 0)`,
          },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: 240,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      );
    }

    previousPositionsRef.current = positions;
    measuredRef.current = true;
  }, [assets]);

  return rowsRef;
}
