// src/components/landing-screen.tsx
'use client'
import React from 'react'
import { cn } from '@/lib/utils'

export function LandingScreen() {
  return (
    <div className={cn('fixed inset-0 z-[100] flex items-center justify-center bg-background')}>
      <div className="glitch-container font-mono text-5xl md:text-8xl font-bold">
        <div className="glitch-text" data-text="COGNITO">
          COGNITO
        </div>
        <div className="glitch-text" data-text="MARKET">
          MARKET
        </div>
      </div>
    </div>
  )
}
