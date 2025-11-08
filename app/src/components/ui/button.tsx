import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none border-2 border-foreground", // MODIFIED: Removed rounded-md, added border
  {
    variants: {
      variant: {
        // MODIFIED: Use CSS var for shadow color
        default:
          'bg-primary text-primary-foreground shadow-[4px_4px_0px_var(--border)] hover:shadow-[6px_6px_0px_var(--border)] hover:-translate-x-0.5 hover:-translate-y-0.5 active:shadow-none active:translate-x-[4px] active:translate-y-[4px]',
        destructive:
          'bg-destructive text-destructive-foreground shadow-[4px_4px_0px_var(--border)] hover:shadow-[6px_6px_0px_var(--border)] hover:-translate-x-0.5 hover:-translate-y-0.5 active:shadow-none active:translate-x-[4px] active:translate-y-[4px]',
        outline:
          'bg-background shadow-[4px_4px_0px_var(--border)] hover:bg-accent hover:text-accent-foreground hover:shadow-[6px_6px_0px_var(--border)] hover:-translate-x-0.5 hover:-translate-y-0.5 active:shadow-none active:translate-x-[4px] active:translate-y-[4px]',
        secondary:
          'bg-secondary text-secondary-foreground shadow-[4px_4px_0px_var(--border)] hover:shadow-[6px_6px_0px_var(--border)] hover:-translate-x-0.5 hover:-translate-y-0.5 active:shadow-none active:translate-x-[4px] active:translate-y-[4px]',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 !border-0', // MODIFIED: No border for ghost
        link: 'text-primary underline-offset-4 hover:underline !border-0', // MODIFIED: No border for link
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
