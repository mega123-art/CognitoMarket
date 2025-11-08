'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Line, LineChart, ResponsiveContainer, Tooltip, TooltipProps, XAxis, YAxis } from 'recharts'

// TODO: Replace this with real data fetched from your new API
const placeholderData = [
  { time: '10:00', yesPrice: 50, noPrice: 50 },
  { time: '10:05', yesPrice: 55, noPrice: 45 },
  { time: '10:10', yesPrice: 52, noPrice: 48 },
  { time: '10:15', yesPrice: 60, noPrice: 40 },
  { time: '10:20', yesPrice: 75, noPrice: 25 },
  { time: '10:25', yesPrice: 70, noPrice: 30 },
]

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

export function MarketPriceChart() {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={placeholderData}
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
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12, fontFamily: 'var(--font-geist-mono)' }}
            tickLine={{ stroke: 'var(--foreground)' }}
            axisLine={{ stroke: 'var(--foreground)', strokeWidth: 2 }}
          />
          <YAxis
            stroke="var(--foreground)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12, fontFamily: 'var(--font-geist-mono)' }}
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
