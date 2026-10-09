import { cn } from '../../lib/cn.js';
import { Skeleton } from './Misc.jsx';

const INTERACTIVE = 'a,button,input,select,textarea,label,[role="menuitem"],[data-no-row-click]';

/**
 * Responsive list: a semantic table from `md` up, compact stacked rows on phones
 * (desktop tables are never squeezed into 360px).
 *
 * columns: [{ key, header, cell(row), className, headerClassName, hideBelow: 'lg' | 'xl' }]
 * mobileRow(row): content of the row on small screens.
 * onRowClick(row): whole row is clickable; the primary cell should still contain a real
 * link/button so keyboard and screen-reader users have a focusable target.
 */
export function DataTable({ columns, rows, rowKey = (r) => r.id, onRowClick, mobileRow, loading, skeletonRows = 6, caption, rowClassName }) {
  const hide = { lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' };
  const click = (e, row) => {
    if (!onRowClick || e.target.closest(INTERACTIVE)) return;
    onRowClick(row);
  };

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-line bg-surface md:block">
        <table className="w-full table-fixed border-collapse text-left">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-line bg-canvas/70">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn('h-8 px-3 text-[11.5px] font-medium uppercase tracking-wide text-ink-subtle', hide[c.hideBelow], c.headerClassName ?? c.className)}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }, (_, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {columns.map((c) => (
                      <td key={c.key} className={cn('h-11 px-3', hide[c.hideBelow])}>
                        <Skeleton className="h-3.5 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={(e) => click(e, row)}
                    className={cn(
                      'border-b border-line transition-colors last:border-0',
                      onRowClick && 'cursor-pointer hover:bg-canvas/80',
                      rowClassName?.(row),
                    )}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={cn('h-11 px-3 py-1.5 align-middle text-[13px]', hide[c.hideBelow], c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface md:hidden" aria-label={caption}>
        {loading
          ? Array.from({ length: Math.min(skeletonRows, 4) }, (_, i) => (
              <li key={i} className="space-y-2 p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </li>
            ))
          : rows.map((row) => (
              <li
                key={rowKey(row)}
                onClick={(e) => click(e, row)}
                className={cn('p-3', onRowClick && 'cursor-pointer active:bg-canvas', rowClassName?.(row))}
              >
                {mobileRow(row)}
              </li>
            ))}
      </ul>
    </>
  );
}
