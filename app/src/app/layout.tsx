// src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'
import { AppProviders } from '@/components/app-providers'
import { AppLayout } from '@/components/app-layout'
import React from 'react'
// Add at the top of the file:
import { Geist, Geist_Mono } from 'next/font/google'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// Then use in body:
const antialiased = `${geistSans.variable} ${geistMono.variable} antialiased`
export const metadata: Metadata = {
  title: 'Cognitomarket',
  description: 'Decentralized Prediction Markets', // Updated description
}

// Updated links
const links: { label: string; path: string }[] = [
  { label: 'Markets', path: '/' },
  { label: 'My Positions', path: '/positions' },
  { label: 'My Account', path: '/account' },
]

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={antialiased}>
        <AppProviders>
          <AppLayout links={links}>{children}</AppLayout>
        </AppProviders>
      </body>
    </html>
  )
}
// Patch BigInt
declare global {
  interface BigInt {
    toJSON(): string
  }
}

BigInt.prototype.toJSON = function () {
  return this.toString()
}
