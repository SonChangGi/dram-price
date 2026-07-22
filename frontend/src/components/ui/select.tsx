/* eslint-disable react-refresh/only-export-components */
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, children, ...props }: SelectPrimitive.SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-11 min-h-11 w-full items-center justify-between gap-2 rounded-[6px] border border-[var(--line)] bg-[var(--panel)] px-3 text-left text-sm font-medium text-[var(--ink)] shadow-none focus:outline-none focus:ring-2 focus:ring-[var(--primary)] data-[placeholder]:text-[var(--muted)]',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild><ChevronDown aria-hidden="true" className="size-4 text-[var(--muted)]" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, position = 'popper', ...props }: SelectPrimitive.SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          'z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--panel)] text-[var(--ink)] shadow-[var(--shadow)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }: SelectPrimitive.SelectItemProps) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex min-h-11 cursor-default select-none items-center rounded-[6px] py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-[var(--surface-raised)] data-[highlighted]:text-[var(--ink)]',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2.5 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator><Check aria-hidden="true" className="size-4 text-[var(--primary)]" /></SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
