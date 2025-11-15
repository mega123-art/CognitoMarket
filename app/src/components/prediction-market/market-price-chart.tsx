// app/src/components/prediction-market/market-price-chart.tsx
'use client'

import React from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useQuery } from '@tanstack/react-query'
import { PublicKey } from '@solana/web3.js'

// Define the structure of our history data
type PriceHistoryPoint = {
  timestamp: string // It's now a simple string, not an object
  yes_liquidity: string
  no_liquidity: string
}

// Define the structure of the data our chart needs
type ChartDataPoint = {
  time: string
  price: number
}

// Helper to fetch data from our new API route
async function fetchMarketHistory(marketPubkey: string): Promise<PriceHistoryPoint[]> {
  const res = await fetch(`/api/history/${marketPubkey}`)
  if (!res.ok) {
    throw new Error('Failed to fetch market history')
  }
  return res.json()
}

// Helper to format the raw Mongo data for the chart
function formatData(data: PriceHistoryPoint[]): ChartDataPoint[] {
  return data.map((point) => {
    // Convert string liquidity to numbers
    const yes = BigInt(point.yes_liquidity)
    const no = BigInt(point.no_liquidity)

    // Calculate price: yes / (yes + no)
    const price = Number((yes * 10000n) / (yes + no)) / 10000

    return {
      // Use the timestamp string directly
      time: new Date(point.timestamp).toLocaleTimeString(),
      price: price,
    }
  })
}

// Accept the market's PublicKey as a prop
export function MarketPriceChart({ marketPubkey }: { marketPubkey: PublicKey }) {
  // Use react-query to fetch and auto-refresh the data
const { data: historyData, isLoading } = useQuery({
  // 1. This is the fix:
  // We use a ternary operator. If marketPubkey exists, use its string.
  // If not, use 'null'. This prevents the .toString() error.
  queryKey: ['market-history', marketPubkey ? marketPubkey.toString() : null],

  // 2. The queryFn is also safer, though `enabled` should prevent it from running.
  queryFn: () => {
    if (!marketPubkey) return null
    return fetchMarketHistory(marketPubkey.toString())
  },

  // This is the magic: refetch every 5 seconds!
  refetchInterval: 5000,
  enabled: !!marketPubkey, // This is still correct and important
})

  // Memoize the formatted data so we don't recalculate on every render
  const chartData = React.useMemo(() => {
    if (!historyData) return []
    return formatData(historyData)
  }, [historyData])

  if (isLoading) {
    return (
      <div className="h-64 w-full flex items-center justify-center">
        <p>Loading chart data...</p>
      </div>
    )
  }

  if (!chartData || chartData.length === 0) {
    return (
      <div className="h-64 w-full flex items-center justify-center">
        <p>No trading data available for this market yet.</p>
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
            right: 20,
            left: -20, // Move Y-axis labels closer
            bottom: 5,
          }}
        >
          <XAxis dataKey="time" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis
            fontSize={12}
            tickLine={false}
            axisLine={false}
            domain={[0, 1]} // Price is always between 0 and 1
            tickFormatter={(value) => `$${value.toFixed(2)}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--background))',
              borderColor: 'hsl(var(--border))',
              borderRadius: '0.5rem',
            }}
            labelStyle={{ color: 'hsl(var(--foreground))' }}
            itemStyle={{ color: 'hsl(var(--foreground))' }}
            formatter={(value: number) => [value.toFixed(4), 'Price']}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
