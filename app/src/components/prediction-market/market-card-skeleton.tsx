import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card'

export function MarketCardSkeleton() {
  return (
    <Card className="flex flex-col justify-between">
      <CardHeader>
        {/* Skeleton for Title and Price blocks */}
        <div className="flex justify-between items-start gap-2">
          <div className="flex flex-col gap-2 flex-1">
            <div className="skeleton-block h-6 w-3/4"></div>
            <div className="skeleton-block h-4 w-1/4"></div>
          </div>
          <div className="flex flex-col items-end shrink-0 gap-1">
            <div className="skeleton-block h-8 w-20"></div>
            <div className="skeleton-block h-8 w-20"></div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Skeleton for Description and Volume */}
        <div className="space-y-2">
          <div className="skeleton-block h-4 w-full"></div>
          <div className="skeleton-block h-4 w-2/3"></div>
          <div className="skeleton-block h-4 w-1/2 mt-2"></div>
        </div>
      </CardContent>
      <CardFooter>
        {/* Skeleton for Button */}
        <div className="skeleton-block h-9 w-full"></div>
      </CardFooter>
    </Card>
  )
}
