import { cn } from '../../lib/cn.js';

/**
 * Brand mark. Placeholder built from the Teamwork navy/yellow palette.
 * To use the official Teamwork IT Solution logo, put the file in src/assets/ and render it
 * in LogoMark — every screen uses this component, so it is a one-file change.
 */
export function LogoMark({ size = 28, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn('shrink-0', className)} aria-hidden="true">
      <rect width="32" height="32" rx="7" className="fill-brand-800" />
      <path d="M8 10h16v4h-6v10h-4V14H8z" className="fill-white" />
      <circle cx="23.5" cy="21.5" r="3" className="fill-accent-500" />
    </svg>
  );
}

export function Logo({ collapsed = false, inverted = false, className }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      {!collapsed && (
        <span className="leading-tight">
          <span className={cn('block text-[15px] font-bold tracking-tight', inverted ? 'text-white' : 'text-brand-800')}>TeamFlow</span>
          <span className={cn('block text-[10px] font-medium uppercase tracking-[0.12em]', inverted ? 'text-brand-200' : 'text-ink-subtle')}>
            by Teamwork IT
          </span>
        </span>
      )}
    </span>
  );
}
