import { forwardRef } from 'react';
import { Link } from 'react-router';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn.js';

const VARIANTS = {
  primary: 'bg-brand-800 text-white shadow-xs hover:bg-brand-700 active:bg-brand-900',
  accent: 'bg-accent-500 text-brand-900 shadow-xs hover:bg-accent-400 active:bg-accent-600',
  secondary: 'border border-line-strong bg-surface text-ink shadow-xs hover:bg-canvas active:bg-line/60',
  ghost: 'text-ink-muted hover:bg-line/60 hover:text-ink active:bg-line',
  danger: 'bg-danger-600 text-white shadow-xs hover:bg-danger-700',
  'danger-ghost': 'text-danger-600 hover:bg-danger-50',
  link: 'h-auto px-0 text-brand-600 underline-offset-2 hover:underline',
};

// Mobile sizes are taller for comfortable touch targets; desktop stays compact.
const SIZES = {
  sm: 'h-8 sm:h-7 px-2.5 text-xs gap-1.5',
  md: 'h-10 sm:h-8 px-3 text-[13px] gap-1.5',
  lg: 'h-11 sm:h-10 px-4 text-sm gap-2',
  icon: 'h-10 w-10 sm:h-8 sm:w-8',
  'icon-sm': 'h-8 w-8 sm:h-7 sm:w-7',
};

export const buttonClasses = ({ variant = 'secondary', size = 'md', className } = {}) =>
  cn(
    'relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium',
    'transition-[background-color,border-color,color,box-shadow] duration-100',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    VARIANTS[variant],
    variant !== 'link' && SIZES[size],
    className,
  );

/**
 * Button system: primary · accent · secondary · ghost · danger · danger-ghost · link,
 * sizes sm · md · lg · icon · icon-sm. Loading keeps the button's size (label is hidden, not removed).
 * Icon-only buttons must receive an aria-label.
 */
export const Button = forwardRef(function Button(
  { variant, size, loading = false, icon: Icon, iconRight: IconRight, className, children, disabled, type = 'button', ...props },
  ref,
) {
  const iconSize = size === 'sm' || size === 'icon-sm' ? 14 : 16;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      <span className={cn('inline-flex items-center gap-[inherit]', loading && 'invisible')}>
        {Icon && <Icon size={iconSize} aria-hidden="true" />}
        {children}
        {IconRight && <IconRight size={iconSize} aria-hidden="true" />}
      </span>
      {loading && <Loader2 size={iconSize} className="absolute animate-spin" aria-hidden="true" />}
    </button>
  );
});

/** A router link that looks like a button. */
export function ButtonLink({ variant, size, icon: Icon, className, children, ...props }) {
  return (
    <Link className={buttonClasses({ variant, size, className })} {...props}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
      {children}
    </Link>
  );
}
