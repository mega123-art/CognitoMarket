'use client'

import { Card, CardContent } from '@/components/ui/card'
import { useQuery } from '@tanstack/react-query'
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

// Define a type for the historical data you expect from your API
type PriceHistoryPoint = {
  timestamp: number
  yes_liquidity: string // API returns bigints as strings
  no_liquidity: string
}

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
  // 1. Fetch data from the API endpoint
  const { data: rawData, isLoading } = useQuery<PriceHistoryPoint[]>({
    queryKey: ['marketHistory', marketPubkey],
    queryFn: async () => {
      const response = await fetch(`/api/markets/${marketPubkey}/history`)
      if (!response.ok) {
        throw new Error('Failed to fetch market history')
      }
      return response.json()
    },
    // Refetch data every 60 seconds
    refetchInterval: 60000,
  })

  // 2. Format the data for the chart
  const chartData = React.useMemo(() => (rawData ? formatData(rawData) : []), [rawData])

  if (isLoading) {
    return <div className="flex items-center justify-center h-full">Loading chart...</div>
  }

  if (!chartData || chartData.length === 0) {
    return <div className="flex items-center justify-center h-full">No chart data available.</div>
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          // 3. Use the fetched data
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
