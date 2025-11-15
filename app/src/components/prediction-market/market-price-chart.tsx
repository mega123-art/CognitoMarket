// app/src/components/prediction-market/market-price-chart.tsx
'use client'

import React from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useQuery } from '@tanstack/react-query'
import { PublicKey } from '@solana/web3.js'
import { Card } from '@/components/ui/card'

// --- 1. Define Data Structures for Real-Time Data ---

// Define the structure of our history data returned from your API route
type PriceHistoryPoint = {
  // We expect a string because JSON.stringify and BigInt conversion
  timestamp: string
  yes_liquidity: string
  no_liquidity: string
}

// Define the structure of the data our chart needs (0-1 price scale)
type ChartDataPoint = {
  time: string
  yesPrice: number
  noPrice: number
}

// Helper to fetch data from your new Next.js API route
async function fetchMarketHistory(marketPubkey: string): Promise<PriceHistoryPoint[]> {
  const res = await fetch(`/api/history/${marketPubkey}`)
  if (!res.ok) {
    // If the API fails, log the error but return an empty array
    console.error(`Error fetching history for ${marketPubkey}: ${res.status}`)
    return []
  }
  return res.json()
}

// Helper to format the raw Mongo data for the chart
function formatData(data: PriceHistoryPoint[]): ChartDataPoint[] {
  return data.map((point) => {
    // Convert string liquidity (from Mongo) to BigInt for math precision
    const yesLiq = BigInt(point.yes_liquidity)
    const noLiq = BigInt(point.no_liquidity)
    const totalLiq = yesLiq + noLiq

    // Calculate price on a 0 to 1 scale
    // yes / (yes + no)
    const yesPrice = totalLiq > 0n ? Number((yesLiq * 10000n) / totalLiq) / 10000 : 0.5
    const noPrice = 1.0 - yesPrice

    return {
      // Use the timestamp string directly and format time
      time: new Date(point.timestamp).toLocaleTimeString(),
      yesPrice: yesPrice,
      noPrice: noPrice,
    }
  })
}

// --- 2. Custom Tooltip ---
const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string | number }) => {
  if (active && payload?.length) {
    const yes = payload.find((p) => p.dataKey === 'yesPrice')?.value ?? 0
    const no = payload.find((p) => p.dataKey === 'noPrice')?.value ?? 0

    return (
      <Card className="bg-background border-2 border-foreground shadow-[4px_4px_0px_var(--border)] p-2">
        <p className="font-mono font-bold">{`Time: ${label}`}</p>
        <p className="font-mono text-primary">{`YES: ${(yes * 100).toFixed(2)}¢`}</p>
        <p className="font-mono text-destructive">{`NO: ${(no * 100).toFixed(2)}¢`}</p>
      </Card>
    )
  }
  return null
}

// --- 3. Main Component ---

// Accept the market's PublicKey as a prop
export function MarketPriceChart({ marketPubkey }: { marketPubkey: PublicKey | null }) {
  // Use react-query to fetch and auto-refresh the data
  const { data: historyData, isLoading } = useQuery({
    queryKey: ['market-history', marketPubkey ? marketPubkey.toString() : null],
    queryFn: () => {
      if (!marketPubkey) return null
      return fetchMarketHistory(marketPubkey.toString())
    },
    // Refetch every 5 seconds for near real-time updates
    refetchInterval: 5000,
    enabled: !!marketPubkey,
  })

  // Memoize the formatted data
  const chartData = React.useMemo(() => {
    if (!historyData) return []
    return formatData(historyData)
  }, [historyData])

  if (isLoading || !marketPubkey) {
    return (
      <div className="h-64 w-full flex items-center justify-center">
        <p>Loading chart data...</p>
      </div>
    )
  }

  // Use raw data length here to show the message when empty
  if (chartData.length === 0) {
    return (
      <div className="h-64 w-full flex items-center justify-center">
        <p className="text-muted-foreground font-mono">No trading data available yet.</p>
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{
            top: 5,
            right: 10,
            left: -20, // Move Y-axis labels closer
            bottom: 5,
          }}
        >
          <XAxis
            dataKey="time"
            stroke="var(--foreground)"
            tick={{
              fill: 'var(--muted-foreground)',
              fontSize: 12,
              fontFamily: 'var(--font-geist-mono)',
            }}
            tickLine={{ stroke: 'var(--foreground)' }}
            axisLine={{ stroke: 'var(--foreground)', strokeWidth: 2 }}
          />
          <YAxis
            stroke="var(--foreground)"
            tick={{
              fill: 'var(--muted-foreground)',
              fontSize: 12,
              fontFamily: 'var(--font-geist-mono)',
            }}
            // Format Y-axis to show price in cents (0¢ to 100¢)
            tickFormatter={(value) => `${(value * 100).toFixed(0)}¢`}
            domain={[0, 1]} // Price domain must be 0 to 1
            tickLine={{ stroke: 'var(--foreground)' }}
            axisLine={{ stroke: 'var(--foreground)', strokeWidth: 2 }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--foreground)', strokeWidth: 2 }} />
          <Line
            type="monotone"
            dataKey="yesPrice"
            stroke="var(--primary)"
            strokeWidth={3}
            dot={true} // <-- FIX: Always show the dot so users see data
            activeDot={{
              stroke: 'var(--background)',
              strokeWidth: 2,
              r: 6,
              fill: 'var(--primary)',
            }}
          />
          <Line
            type="monotone"
            dataKey="noPrice"
            stroke="var(--destructive)"
            strokeWidth={3}
            dot={true} // <-- FIX: Always show the dot so users see data
            activeDot={{
              stroke: 'var(--background)',
              strokeWidth: 2,
              r: 6,
              fill: 'var(--destructive)',
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
