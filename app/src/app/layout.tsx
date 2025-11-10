// src/app/layout.tsx
'use client' // MODIFIED: Add 'use client' to use hooks

import './globals.css'
import { AppProviders } from '@/components/app-providers'
import { AppLayout } from '@/components/app-layout'
import React, { useState, useEffect } from 'react' // MODIFIED: Import hooks
import { Geist, Geist_Mono } from 'next/font/google'
import { LandingScreen } from '@/components/landing-screen' // MODIFIED: Import LandingScreen
// MODIFIED: Remove effect component imports
// import { FloatingBuyElements } from '@/components/floating-buy-elements'
// import { ConfettiEffect } from '@/components/confetti-effect'

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

/*
export const metadata: Metadata = {
  title: 'Cognitomarket',
  description: 'Decentralized Prediction Markets', // Updated description
}
*/

// Updated links
const links: { label: string; path: string }[] = [
  { label: 'Markets', path: '/' },
  { label: 'My Positions', path: '/positions' },
  { label: 'My Account', path: '/account' },
]

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // MODIFIED: Add state for loading screen
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Hide landing screen after 2.5 seconds
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 2500) // 2.5 seconds

    return () => clearTimeout(timer)
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={antialiased}>
        {/* MODIFIED: Conditionally render LandingScreen or App content */}
        {isLoading ? (
          <LandingScreen />
        ) : (
          <AppProviders>
            <AppLayout links={links}>{children}</AppLayout>
          </AppProviders>
        )}
        {/* MODIFIED: Removed effect components from here */}
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
