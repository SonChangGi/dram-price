import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] border px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary-strong)]',
        outline: 'border-[var(--line)] bg-[var(--panel)] text-[var(--ink)] hover:bg-[var(--surface-raised)]',
        ghost: 'border-transparent bg-transparent text-[var(--muted-strong)] hover:bg-[var(--surface-raised)] hover:text-[var(--ink)]',
      },
      size: {
        default: 'h-11',
        icon: 'size-11 p-0',
      },
    },
    defaultVariants: { variant: 'outline', size: 'default' },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ asChild = false, className, variant, size, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
