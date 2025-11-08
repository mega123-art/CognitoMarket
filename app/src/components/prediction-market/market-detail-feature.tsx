// src/components/prediction-market/market-detail-feature.tsx
'use client'

import { usePredictionMarket } from '@/lib/prediction-market-data-access'
import { BN } from '@coral-xyz/anchor'
import { AppHero } from '../app-hero'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useState } from 'react'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletButton } from '../solana/solana-provider'
import { cn } from '@/lib/utils' // Import cn utility

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

  // FIX: Hooks must be called at the top level, not conditionally.
  const { data: market, isLoading } = useGetMarketByPubkey(new PublicKey(marketId))

  // Use the public key directly instead of deriving from marketId
  let marketPubkey: PublicKey
  try {
    marketPubkey = new PublicKey(marketId)
  } catch {
    // FIX: Removed unused 'e' variable
    return <div>Invalid market address</div>
  }

  const handleBuy = (isYes: boolean) => {
    const amountLamports = new BN(parseFloat(amountSol) * LAMPORTS_PER_SOL)
    buyShares.mutateAsync({
      marketPubkey: marketPubkey,
      isYes,
      amountLamports,
      minSharesOut: new BN(0),
    })
  }

  if (isLoading) return <div>Loading market...</div>
  if (!market) return <div>Market not found</div>

  const yesPrice = getPrice(market.yesLiquidity, market.noLiquidity)
  const noPrice = 1 - yesPrice
  const isResolved = market.resolved

  return (
    <div>
      <AppHero
        title={market.question}
        subtitle={
          <div className="flex flex-col items-center">
            <p className="text-lg">{market.description}</p>
            <span className="text-sm text-muted-foreground mt-2">
              Resolves: {new Date(Number(market.resolutionTime) * 1000).toLocaleString()}
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Market Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">YES Price</span>
              <span className="font-bold text-green-600">{(yesPrice * 100).toFixed(0)}¢</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">NO Price</span>
              <span className="font-bold text-red-600">{(noPrice * 100).toFixed(0)}¢</span>
            </div>
            <div className="border-t pt-2 mt-2">
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
              <div className="flex justify-between items-center pt-4 text-lg font-bold border-t mt-2">
                <span className="text-muted-foreground">Outcome</span>
                <span className={cn('text-2xl font-extrabold', market.outcome ? 'text-green-500' : 'text-red-500')}>
                  {market.outcome ? 'YES' : 'NO'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trade</CardTitle>
            <CardDescription>Buy shares for YES or NO</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isResolved ? (
              <div className="text-center font-bold text-lg space-y-2">
                <div>Market has resolved. Trading is closed.</div>
                <div className={cn('text-3xl font-extrabold', market.outcome ? 'text-green-500' : 'text-red-500')}>
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
                  <Label htmlFor="amount">Amount (SOL)</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={amountSol}
                    onChange={(e) => setAmountSol(e.target.value)}
                    disabled={buyShares.isPending}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Button
                      variant="default"
                      className="w-full bg-green-600 hover:bg-green-700"
                      onClick={() => handleBuy(true)}
                      disabled={buyShares.isPending}
                    >
                      {buyShares.isPending ? 'Buying...' : 'Buy YES'}
                    </Button>
                    <div className="text-center text-xs text-muted-foreground">@ {(yesPrice * 100).toFixed(0)}¢</div>
                  </div>
                  <div className="space-y-2">
                    <Button
                      variant="default"
                      className="w-full bg-red-600 hover:bg-red-700"
                      onClick={() => handleBuy(false)}
                      disabled={buyShares.isPending}
                    >
                      {buyShares.isPending ? 'Buying...' : 'Buy NO'}
                    </Button>
                    <div className="text-center text-xs text-muted-foreground">@ {(noPrice * 100).toFixed(0)}¢</div>
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
