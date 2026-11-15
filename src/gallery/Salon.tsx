import { Children, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** Narrowest a column may get before the wall drops to fewer columns, in pixels. */
  minColumnWidth?: number;
  maxColumns?: number;
  className?: string;
  children: ReactNode;
}

/** Below this viewport width every wall hangs in two columns. */
const NARROW_QUERY = '(max-width: 720px)';

/**
 * A salon hang: works dealt left to right into fixed columns.
 *
 * CSS multi-column layout rebalances the whole wall whenever any image changes
 * height, so lazily loaded works jump between columns as you scroll. Here a
 * work's column is decided by its position alone, so a late image only pushes
 * down the works beneath it, and appending works never moves the ones hung.
 */
export function Salon({ minColumnWidth = 230, maxColumns = 4, className, children }: Props) {
  const wall = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = wall.current;
    if (!element) return;
    const measure = () => {
      if (window.matchMedia(NARROW_QUERY).matches) return setColumns(Math.min(2, maxColumns));
      const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
      const fit = Math.floor((element.clientWidth + gap) / (minColumnWidth + gap));
      setColumns(Math.max(1, Math.min(maxColumns, fit)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [minColumnWidth, maxColumns]);

  const works = Children.toArray(children);
  return (
    <div ref={wall} className={'salon' + (className ? ' ' + className : '')}>
      {columns !== null &&
        Array.from({ length: columns }, (_, column) => (
          <div key={column} className="salon-column">
            {works.filter((_, index) => index % columns === column)}
          </div>
        ))}
    </div>
  );
}
