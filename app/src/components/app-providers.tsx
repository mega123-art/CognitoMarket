// src/components/app-providers.tsx
'use client'

import { ThemeProvider } from '@/components/theme-provider'
import { ReactQueryProvider } from './react-query-provider'
import { SolanaProvider } from './solana/solana-provider'
import { Toaster } from '@/components/ui/sonner'
import { FloatingBuyElements } from './floating-buy-elements'
import { ConfettiEffect } from './confetti-effect'
import { ClusterProvider } from './cluster/cluster-data-access'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false} // <-- MODIFIED
      disableTransitionOnChange
    >
      <ReactQueryProvider>
        <ClusterProvider>
          <SolanaProvider>
            {children}
            <Toaster />
            <FloatingBuyElements />
            <ConfettiEffect />
          </SolanaProvider>
        </ClusterProvider>
      </ReactQueryProvider>
    </ThemeProvider>
  )
}
