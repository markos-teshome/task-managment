import * as DM from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/** Accessible dropdown menu (keyboard navigation, typeahead, focus management via Radix). */
export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = 'end', className, ...props }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={4}
        collisionPadding={8}
        className={cn(
          'z-50 min-w-44 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-lg data-[state=open]:animate-pop-in',
          className,
        )}
        {...props}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({ icon: Icon, tone, className, children, ...props }) {
  return (
    <DM.Item
      className={cn(
        'flex h-9 sm:h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[13px] outline-none',
        'data-[highlighted]:bg-canvas data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        tone === 'danger' ? 'text-danger-600 data-[highlighted]:bg-danger-50' : 'text-ink',
        className,
      )}
      {...props}
    >
      {Icon && <Icon size={15} className={tone === 'danger' ? '' : 'text-ink-subtle'} aria-hidden="true" />}
      {children}
    </DM.Item>
  );
}

/** Single-choice item (e.g. status picker) with a checkmark on the current value. */
export function MenuChoice({ selected, children, ...props }) {
  return (
    <MenuItem {...props}>
      <span className="flex-1">{children}</span>
      {selected && <Check size={14} className="text-brand-600" aria-label="Current" />}
    </MenuItem>
  );
}

export function MenuLabel({ children }) {
  return <DM.Label className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{children}</DM.Label>;
}

export function MenuSeparator() {
  return <DM.Separator className="-mx-1 my-1 h-px bg-line" />;
}
