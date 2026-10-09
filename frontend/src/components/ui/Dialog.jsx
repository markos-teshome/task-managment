import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from './Button.jsx';
import { cn } from '../../lib/cn.js';

/*
 * Modal and Drawer are built on Radix Dialog: focus trap, Esc to close, focus return,
 * aria-modal and labelled title come for free.
 * On phones the modal becomes a bottom sheet (no clipped dialogs, thumb-reachable actions).
 */

const overlay = 'fixed inset-0 z-50 bg-ink/40 backdrop-blur-[1px] data-[state=open]:animate-fade-in';

function Header({ title, description, onClose }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <RD.Title className="text-[15px] font-semibold text-ink">{title}</RD.Title>
        {description ? (
          <RD.Description className="mt-0.5 text-[13px] text-ink-muted">{description}</RD.Description>
        ) : (
          <RD.Description className="sr-only">{title}</RD.Description>
        )}
      </div>
      <RD.Close asChild>
        <Button variant="ghost" size="icon-sm" icon={X} aria-label="Close" onClick={onClose} className="-mr-1.5 -mt-0.5" />
      </RD.Close>
    </div>
  );
}

/** Footer for dialog actions. On phones, buttons stretch to share the row. */
export function DialogFooter({ children, className }) {
  return (
    <div className={cn('flex shrink-0 items-center justify-end gap-2 border-t border-line bg-canvas/60 px-4 py-3 sm:px-5 max-sm:[&>*]:flex-1', className)}>
      {children}
    </div>
  );
}

export function DialogBody({ children, className }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5', className)}>{children}</div>;
}

export function Modal({ open, onOpenChange, title, description, size = 'md', children }) {
  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }[size];
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className={overlay} />
        <RD.Content
          className={cn(
            'fixed z-50 flex flex-col bg-surface shadow-lg focus:outline-none',
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-xl data-[state=open]:animate-slide-in-up',
            'sm:inset-auto sm:left-1/2 sm:top-[8vh] sm:max-h-[84vh] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:rounded-lg sm:data-[state=open]:animate-pop-in',
            width,
          )}
        >
          <Header title={title} description={description} />
          {children}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/** Side panel for details (e.g. a task) — keeps the list visible on large screens. */
export function Drawer({ open, onOpenChange, title, description, children, hideHeader = false }) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className={cn(overlay, 'bg-ink/25')} />
        <RD.Content className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-lg focus:outline-none data-[state=open]:animate-slide-in-right sm:max-w-[520px]">
          {hideHeader ? (
            <>
              <RD.Title className="sr-only">{title}</RD.Title>
              <RD.Description className="sr-only">{description ?? title}</RD.Description>
            </>
          ) : (
            <Header title={title} description={description} />
          )}
          {children}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export const DialogClose = RD.Close;

/** Confirmation for destructive actions only. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, loading, tone = 'danger', children }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size="sm">
      <DialogBody>
        <p className="text-[13px] leading-relaxed text-ink-muted">{description}</p>
        {children}
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
