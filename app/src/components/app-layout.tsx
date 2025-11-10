// src/components/app-layout.tsx
import { ReactNode } from 'react'
import { AppFooter } from './app-footer'
import { AppHeader } from './app-header'
// MODIFIED: Remove ClusterProvider import
// import { ClusterProvider } from './cluster/cluster-data-access'

export function AppLayout({ children, links }: { children: ReactNode; links: { label: string; path: string }[] }) {
  return (
    // MODIFIED: Remove ClusterProvider wrapper from here
    <div className="flex h-full min-h-screen flex-col">
      <AppHeader links={links} />
      <main className="flex-grow max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 w-full">{children}</main>
      <AppFooter />
    </div>
  )
}
