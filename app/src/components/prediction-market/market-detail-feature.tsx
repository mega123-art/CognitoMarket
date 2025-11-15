// src/components/prediction-market/market-detail-feature.tsx
'use client'

import { usePredictionMarket } from '@/lib/prediction-market-data-access'
import { BN } from '@coral-xyz/anchor'
import { AppHero } from '../app-hero'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useMemo, useState } from 'react' // MODIFIED: Import useMemo
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletButton } from '../solana/solana-provider'
import { cn } from '@/lib/utils'
import { MarketPriceChart } from './market-price-chart' // MODIFIED: Import is the same

// Helper to calculate price
function getPrice(yesLiquidity: bigint, noLiquidity: bigint): number {
  if (yesLiquidity === 0n || noLiquidity === 0n) return 0.5
  const price = Number(yesLiquidity) / (Number(yesLiquidity) + Number(noLiquidity))
  return price
}

export function MarketDetailFeature({ marketId }: { marketId: string }) {
  const { useGetMarketByPubkey, buyShares } = usePredictionMarket()
  const { publicKey } = useWallet()
  const [amountSol, setAmountSol] = useState('0.1')

  // FIX: Safely parse the marketId using useMemo at the top level
  const marketPubkey = useMemo(() => {
    try {
      return new PublicKey(marketId)
    } catch {
      return null
    }
  }, [marketId])

  // FIX: Call the hook unconditionally.
  // We will modify useGetMarketByPubkey to handle a null key.
  const { data: market, isLoading } = useGetMarketByPubkey(marketPubkey)

  const handleBuy = (isYes: boolean) => {
    if (!marketPubkey) return // Should not happen if we check below
    const amountLamports = new BN(parseFloat(amountSol) * LAMPORTS_PER_SOL)
    buyShares.mutateAsync({
      marketPubkey: marketPubkey,
      isYes,
      amountLamports,
      minSharesOut: new BN(0),
    })
  }

  // FIX: Perform conditional returns *after* all hooks have been called
  if (!marketPubkey) {
    return <div>Invalid market address</div>
  }

  if (isLoading) return <div>Loading market...</div>
  if (!market) return <div>Market not found</div>

  const yesPrice = getPrice(market.yesLiquidity, market.noLiquidity)
  const noPrice = 1 - yesPrice
  const isResolved = market.resolved

  // MODIFIED: Apply dynamic style for shadow/border color
  const priceColor = yesPrice > 0.5 ? 'var(--primary)' : yesPrice < 0.5 ? 'var(--destructive)' : 'var(--border)'
  const cardStyle = {
    '--border': priceColor, // This will be used by the card's border AND shadow
  } as React.CSSProperties

  return (
    <div>
      <AppHero
        title={market.question}
        subtitle={
          <div className="flex flex-col items-center font-mono">
            <p className="text-lg">{market.description}</p>
            <span className="text-sm text-muted-foreground mt-2">
              Resolves: {new Date(Number(market.resolutionTime) * 1000).toLocaleString()}
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* MODIFIED: Added dynamic style for shadow/border color */}
        <Card style={cardStyle}>
          <CardHeader>
            <CardTitle>Market Details</CardTitle>
          </CardHeader>
          {/* MODIFIED: Added space-y-4 for better layout with chart */}
          <CardContent className="space-y-4">
            {/* MODIFIED: Added Chart Component AND removed marketPubkey prop */}
            <div className="h-64">
              <MarketPriceChart marketPubkey={marketPubkey} />
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-muted-foreground">YES Price</span>
              <span className="font-bold text-primary">{(yesPrice * 100).toFixed(0)}¢</span>
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-muted-foreground">NO Price</span>
              <span className="font-bold text-destructive">{(noPrice * 100).toFixed(0)}¢</span>
            </div>
            <div className="border-t-2 border-foreground pt-2 mt-2 font-mono space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Volume</span>
                <span>{(Number(market.totalVolume) / LAMPORTS_PER_SOL).toFixed(4)} SOL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Liquidity</span>
                <span>
                  {((Number(market.yesLiquidity) + Number(market.noLiquidity)) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                </span>
              </div>
            </div>
            {isResolved && (
              <div className="flex justify-between items-center pt-4 text-lg font-bold border-t-2 border-foreground mt-2 font-mono">
                <span className="text-muted-foreground">Outcome</span>
                <span className={cn('text-2xl font-extrabold', market.outcome ? 'text-primary' : 'text-destructive')}>
                  {market.outcome ? 'YES' : 'NO'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* MODIFIED: Added dynamic style for shadow/border color */}
        <Card style={cardStyle}>
          <CardHeader>
            <CardTitle>Trade</CardTitle>
            <CardDescription className="font-mono">Buy shares for YES or NO</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isResolved ? (
              <div className="text-center font-bold text-lg space-y-2 font-mono">
                <div>Market has resolved. Trading is closed.</div>
                <div className={cn('text-3xl font-extrabold', market.outcome ? 'text-primary' : 'text-destructive')}>
                  Outcome: {market.outcome ? 'YES' : 'NO'}
                </div>
              </div>
            ) : !publicKey ? (
              <div className="flex justify-center">
                <WalletButton />
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="amount" className="font-mono">
                    Amount (SOL)
                  </Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={amountSol}
                    onChange={(e) => setAmountSol(e.target.value)}
                    disabled={buyShares.isPending}
                    className="font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Button
                      variant="default"
                      className="w-full" // Removed custom colors to use 'default' variant
                      onClick={() => handleBuy(true)}
                      disabled={buyShares.isPending}
                    >
                      {buyShares.isPending ? 'Buying...' : 'Buy YES'}
                    </Button>
                    <div className="text-center text-xs text-muted-foreground font-mono">
                      @ {(yesPrice * 100).toFixed(0)}¢
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Button
                      variant="destructive" // Use 'destructive' variant
                      className="w-full"
                      onClick={() => handleBuy(false)}
                      disabled={buyShares.isPending}
                    >
                      {buyShares.isPending ? 'Buying...' : 'Buy NO'}
                    </Button>
                    <div className="text-center text-xs text-muted-foreground font-mono">
                      @ {(noPrice * 100).toFixed(0)}¢
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
