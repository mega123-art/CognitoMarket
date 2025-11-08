// src/components/prediction-market/market-feature.tsx
'use client'

import { usePredictionMarket } from '@/lib/prediction-market-data-access'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import Link from 'next/link'
import { Button } from '../ui/button'
import { AppHero } from '../app-hero'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { Key } from 'react'
import { cn } from '@/lib/utils' // Import cn utility

// Helper to calculate price
function getPrice(yesLiquidity: bigint, noLiquidity: bigint): number {
  if (yesLiquidity === 0n || noLiquidity === 0n) return 0.5
  const price = Number(yesLiquidity) / (Number(yesLiquidity) + Number(noLiquidity))
  return price
}

// FIX: Define a type for the market account to avoid 'any'
interface MarketAccount {
  question: string
  description: string
  category: string
  yesLiquidity: bigint
  noLiquidity: bigint
  totalVolume: bigint
  resolved: boolean
  outcome: boolean | null
}

// FIX: Define a type for the market prop
interface MarketProp {
  account: MarketAccount
  publicKey: {
    toString: () => Key | null | undefined
  }
}

export function MarketFeature() {
  const { getMarkets } = usePredictionMarket()

  return (
    <div>
      {/* MODIFIED: Use mono font for hero title */}
      <AppHero
        title={<span className="font-mono">Cognitomarket</span>}
        subtitle={<span className="font-mono">Decentralized Prediction Markets</span>}
      />
      {getMarkets.isLoading && <div>Loading markets...</div>}
      {getMarkets.isError && <div className="alert alert-error">Error loading markets: {getMarkets.error.message}</div>}

      {/* MODIFIED: Increased gap for brutalist layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {/* FIX: Use the specific MarketProp type */}
        {getMarkets.data?.map((market: MarketProp) => {
          {
            /* FIX: Remove 'as any' since the type is now correct */
          }
          const marketAccount = market.account
          const yesPrice = getPrice(marketAccount.yesLiquidity, marketAccount.noLiquidity)
          const noPrice = 1 - yesPrice
          const isResolved = marketAccount.resolved

          // MODIFIED: Determine the border/shadow color. This overrides the CSS var
          const priceColor = yesPrice > 0.5 ? 'var(--primary)' : yesPrice < 0.5 ? 'var(--destructive)' : 'var(--border)'
          const cardStyle = {
            '--border': priceColor, // This will be used by the card's border AND shadow
          } as React.CSSProperties

          return (
            // MODIFIED: Apply dynamic style for shadow/border color
            <Card key={market.publicKey.toString()} className="flex flex-col justify-between" style={cardStyle}>
              <CardHeader>
                <CardTitle className="flex justify-between items-start gap-2">
                  <span className="flex-1 text-lg">{marketAccount.question}</span>
                  {isResolved ? (
                    <span
                      className={cn(
                        'text-4xl font-mono font-bold shrink-0', // MODIFIED: Bigger, mono font
                        marketAccount.outcome ? 'text-primary' : 'text-destructive', // MODIFIED: Use new colors
                      )}
                    >
                      {marketAccount.outcome ? 'YES' : 'NO'}
                    </span>
                  ) : (
                    <div className="flex flex-col items-end shrink-0">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">YES</span>
                        {/* MODIFIED: Bigger, mono font, new colors */}
                        <span className="text-3xl font-bold font-mono text-primary">
                          {(yesPrice * 100).toFixed(0)}¢
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">NO</span>
                        {/* MODIFIED: Bigger, mono font, new colors */}
                        <span className="text-3xl font-bold font-mono text-destructive">
                          {(noPrice * 100).toFixed(0)}¢
                        </span>
                      </div>
                    </div>
                  )}
                </CardTitle>
                <CardDescription className="font-mono uppercase">{marketAccount.category}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{marketAccount.description}</p>
                <div className="text-xs text-muted-foreground mt-2 font-mono">
                  Volume: {(Number(marketAccount.totalVolume) / LAMPORTS_PER_SOL).toFixed(2)} SOL
                </div>
              </CardContent>
              <CardFooter>
                <Button asChild variant="outline" className="w-full">
                  <Link href={`/markets/${market.publicKey.toString()}`}>
                    {isResolved ? 'View Resolution' : 'Trade'}
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
