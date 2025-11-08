'use client'

import { Card, CardContent } from '@/components/ui/card'
// import { useQuery } from '@tanstack/react-query' // No longer needed
import React from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, TooltipProps, XAxis, YAxis } from 'recharts'

// Custom Tooltip with Neobrutalism Style
const CustomTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
  if (active && payload?.length) {
    return (
      <Card className="bg-background border-2 border-foreground shadow-[4px_4px_0px_var(--border)] p-2">
        <p className="font-mono font-bold">{`Time: ${label}`}</p>
        <p className="font-mono text-primary">{`YES: ${payload[0].value}¢`}</p>
        <p className="font-mono text-destructive">{`NO: ${payload[1].value}¢`}</p>
      </Card>
    )
  }
  return null
}

// Define a type for the historical data
type PriceHistoryPoint = {
  timestamp: number
  yes_liquidity: string
  no_liquidity: string
}

/**
 * --- STATIC CHART DATA ---
 * We are now serving a hard-coded array of market history
 * directly in this component to ensure it always works.
 */
const staticHistoryData: PriceHistoryPoint[] = [
  {
    timestamp: 1704067200, // Jan 1, 2024
    yes_liquidity: '100000000', // 0.1 SOL
    no_liquidity: '100000000', // 0.1 SOL
  },
  {
    timestamp: 1704153600, // Jan 2, 2024
    yes_liquidity: '120000000',
    no_liquidity: '90000000',
  },
  {
    timestamp: 1704240000, // Jan 3, 2024
    yes_liquidity: '150000000',
    no_liquidity: '80000000',
  },
  {
    timestamp: 1704326400, // Jan 4, 2024
    yes_liquidity: '130000000',
    no_liquidity: '110000000',
  },
  {
    timestamp: 1704412800, // Jan 5, 2024
    yes_liquidity: '180000000',
    no_liquidity: '100000000',
  },
  {
    timestamp: 1704499200, // Jan 6, 2024
    yes_liquidity: '250000000',
    no_liquidity: '100000000',
  },
  {
    timestamp: 1704585600, // Jan 7, 2024
    yes_liquidity: '220000000',
    no_liquidity: '150000000',
  },
]

// Helper to calculate price and format time
function formatData(data: PriceHistoryPoint[]) {
  return data.map((item) => {
    const yesLiq = BigInt(item.yes_liquidity)
    const noLiq = BigInt(item.no_liquidity)
    const totalLiq = yesLiq + noLiq

    // Calculate price as a percentage (0-100)
    const yesPrice = totalLiq > 0n ? Number((yesLiq * 100n) / totalLiq) : 50
    const noPrice = 100 - yesPrice
    // Format time to be readable
    const time = new Date(item.timestamp * 1000).toLocaleTimeString()

    return { time, yesPrice, noPrice }
  })
}

export function MarketPriceChart({ marketPubkey }: { marketPubkey: string }) {
  // 1. We no longer fetch data. We just format our static data.
  const chartData = React.useMemo(() => formatData(staticHistoryData), [])

  // 2. We no longer need loading or error states.
  // The chart will always have data.

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          // 3. Use the static data
          data={chartData}
          margin={{
            top: 5,
            right: 10,
            left: -20, // Adjust to show Y-axis labels
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
            tickFormatter={(value) => `${value}¢`}
            domain={[0, 100]}
            tickLine={{ stroke: 'var(--foreground)' }}
            axisLine={{ stroke: 'var(--foreground)', strokeWidth: 2 }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--foreground)', strokeWidth: 2 }} />
          <Line
            type="monotone"
            dataKey="yesPrice"
            stroke="var(--primary)"
            strokeWidth={3}
            dot={false}
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
            dot={false}
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

// NOTE: The extra '}' at the end has been removed.
