// src/components/prediction-market/market-detail-feature.tsx
'use client'

import { usePredictionMarket } from '@/lib/prediction-market-data-access'
import { BN } from '@coral-xyz/anchor'
import { AppHero } from '../app-hero'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useMemo, useState } from 'react'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletButton } from '../solana/solana-provider'
import { cn } from '@/lib/utils'
import { MarketPriceChart, fetchMarketHistory, formatData, type PriceHistoryPoint } from './market-price-chart'
import { useQuery } from '@tanstack/react-query'
import { Table, TableHeader, TableRow, TableHead, TableCell, TableBody, TableCaption } from '../ui/table'
import { ExplorerLink } from '../cluster/cluster-ui'
import { ellipsify } from '@/lib/utils'

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

  const marketPubkey = useMemo(() => {
    try {
      return new PublicKey(marketId)
    } catch {
      return null
    }
  }, [marketId])

  const { data: market, isLoading: isMarketLoading } = useGetMarketByPubkey(marketPubkey)

  // Fetch history data here in the parent component
  const { data: historyData, isLoading: isHistoryLoading } = useQuery({
    queryKey: ['market-history', marketPubkey ? marketPubkey.toString() : null],
    queryFn: () => {
      if (!marketPubkey) return null
      return fetchMarketHistory(marketPubkey.toString())
    },
    refetchInterval: 5000,
    enabled: !!marketPubkey,
  })

  // Memoize chart data
  const chartData = useMemo(() => {
    if (!historyData) return []
    return formatData(historyData)
  }, [historyData])

  // Memoize trade data for the new table
  const tradeHistory = useMemo(() => {
    if (!historyData) return []
    // Show last 10 trades in reverse chronological order
    return historyData.slice(-10).reverse()
  }, [historyData])

  if (!marketPubkey) {
    return <div>Invalid market address</div>
  }

  if (isMarketLoading) return <div>Loading market...</div>
  if (!market) return <div>Market not found</div>

  const yesPrice = getPrice(market.yesLiquidity, market.noLiquidity)
  const noPrice = 1 - yesPrice
  const isResolved = market.resolved

  const priceColor = yesPrice > 0.5 ? 'var(--primary)' : yesPrice < 0.5 ? 'var(--destructive)' : 'var(--border)'
  const cardStyle = {
    '--border': priceColor,
  } as React.CSSProperties

  // --- BUY SHARES HANDLER ---
  const handleBuy = (isYes: boolean) => {
    if (!publicKey || !marketPubkey) return

    const lamports = new BN(parseFloat(amountSol) * LAMPORTS_PER_SOL)
    // TODO: Add slippage calculation
    const minSharesOut = new BN(0)

    buyShares.mutate({
      marketPubkey,
      isYes,
      amountLamports: lamports,
      minSharesOut,
    })
  }
  // --- END HANDLER ---

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
        {/* === LEFT PANEL: Market Details === */}
        <Card style={cardStyle}>
          <CardHeader>
            <CardTitle>Market Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Price Chart */}
            <div className="h-64">
              <MarketPriceChart chartData={chartData} isLoading={isHistoryLoading} />
            </div>

            {/* Price Readouts */}
            <div className="flex justify-between font-mono">
              <span className="text-muted-foreground">YES Price</span>
              <span className="font-bold text-primary">{(yesPrice * 100).toFixed(0)}¢</span>
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-muted-foreground">NO Price</span>
              <span className="font-bold text-destructive">{(noPrice * 100).toFixed(0)}¢</span>
            </div>

            {/* MOVED: Volume and Liquidity */}

            {/* Resolved Outcome */}
            {isResolved && (
              <div className="flex justify-between items-center pt-4 text-lg font-bold border-t-2 border-foreground mt-2 font-mono">
                <span className="text-muted-foreground">Outcome</span>
                <span className={cn('text-2xl font-extrabold', market.outcome ? 'text-primary' : 'text-destructive')}>
                  {market.outcome ? 'YES' : 'NO'}
                </span>
              </div>
            )}

            {/* MOVED: Live Trades Table */}
          </CardContent>
        </Card>

        {/* === RIGHT PANEL: Trade & Activity === */}
        <Card style={cardStyle}>
          <CardHeader>
            <CardTitle>Trade & Activity</CardTitle>
            <CardDescription className="font-mono">Buy shares for YES or NO</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Trade UI */}
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
                      className="w-full"
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
                      variant="destructive"
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

            {/* --- MODIFICATION: MOVED CONTENT WRAPPER --- */}
            {/* This content now lives in the right panel */}
            <div className="space-y-6 pt-4 border-t-2 border-foreground mt-4">
              {/* Volume and Liquidity */}
              <div className="font-mono space-y-2">
                <h3 className="font-mono font-bold text-lg mb-2">Market Stats</h3>
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

              {/* Live Trades Table */}
              <div className="space-y-2">
                <h3 className="font-mono font-bold text-lg">Live Trades</h3>
                <Table>
                  {tradeHistory.length === 0 && (
                    <TableCaption className="mt-0">
                      {isHistoryLoading ? 'Loading trades...' : 'No trades yet.'}
                    </TableCaption>
                  )}
                  <TableHeader>
                    <TableRow>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Shares</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead className="text-right">Tx</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tradeHistory.map((trade: PriceHistoryPoint) => (
                      <TableRow key={trade.tx_signature} className="font-mono">
                        <TableCell>
                          <span className={cn(trade.is_yes ? 'text-primary' : 'text-destructive', 'font-bold')}>
                            {trade.is_yes ? 'YES' : 'NO'}
                          </span>
                        </TableCell>
                        <TableCell>{(Number(trade.shares) / 1_000_000).toFixed(2)}</TableCell>
                        <TableCell>{new Date(trade.timestamp).toLocaleTimeString()}</TableCell>
                        <TableCell className="text-right">
                          <ExplorerLink path={`tx/${trade.tx_signature}`} label={ellipsify(trade.tx_signature, 4)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            {/* --- END MOVED CONTENT --- */}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
