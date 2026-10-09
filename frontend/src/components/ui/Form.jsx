import { forwardRef, useId, cloneElement, Children, isValidElement } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn.js';

const control =
  'w-full rounded-md border border-line-strong bg-surface px-2.5 text-[16px] sm:text-[13px] text-ink shadow-xs ' +
  'placeholder:text-ink-subtle transition-colors hover:border-ink-subtle/50 ' +
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ' +
  'disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-subtle ' +
  'aria-[invalid=true]:border-danger-600 aria-[invalid=true]:focus:ring-danger-600/15';
// 16px text on mobile prevents iOS zooming into focused inputs.

/**
 * Label + control + hint/error, wired for screen readers (label[for], aria-describedby, aria-invalid).
 * Pass a single control element as the child.
 */
export function Field({ label, hint, error, required, optional, className, children, labelAction }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const child = Children.only(children);
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={id} className="text-[13px] font-medium text-ink">
            {label}
            {required && <span className="ml-0.5 text-danger-600" aria-hidden="true">*</span>}
            {optional && <span className="ml-1 font-normal text-ink-subtle">(optional)</span>}
          </label>
          {labelAction}
        </div>
      )}
      {isValidElement(child)
        ? cloneElement(child, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, 'aria-required': required || undefined })
        : child}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1 text-xs text-danger-600">
          <AlertCircle size={12} aria-hidden="true" /> {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, 'h-10 sm:h-8', className)} {...props} />;
});

export const Textarea = forwardRef(function Textarea({ className, rows = 3, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(control, 'resize-y py-1.5 leading-relaxed', className)} {...props} />;
});

/** Native select (best on mobile and for accessibility), styled to match inputs. */
export const Select = forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <div className={cn('relative', className)}>
      <select ref={ref} className={cn(control, 'h-10 sm:h-8 cursor-pointer appearance-none pr-8')} {...props}>
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
    </div>
  );
});

export const Checkbox = forwardRef(function Checkbox({ className, label, description, ...props }, ref) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong accent-brand-800 disabled:cursor-not-allowed"
        {...props}
      />
      {label && (
        <label htmlFor={id} className="cursor-pointer select-none text-[13px] leading-5 text-ink">
          {label}
          {description && <span className="block text-xs text-ink-subtle">{description}</span>}
        </label>
      )}
    </div>
  );
});

/** Form-level error (not tied to a field), e.g. "Incorrect email or password." */
export function FormAlert({ children, tone = 'danger', className }) {
  if (!children) return null;
  const tones = {
    danger: 'border-danger-600/20 bg-danger-50 text-danger-700',
    success: 'border-success-600/20 bg-success-50 text-success-700',
    info: 'border-info-600/20 bg-info-50 text-brand-800',
  };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]', tones[tone], className)}>
      <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
