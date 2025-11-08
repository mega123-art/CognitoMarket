import React from 'react'

export function AppHero({
  children,
  subtitle,
  title,
}: {
  children?: React.ReactNode
  subtitle?: React.ReactNode
  title?: React.ReactNode
}) {
  return (
    <div className="flex flex-row justify-center py-[16px] md:py-[64px]">
      <div className="text-center">
        <div className="max-w-2xl">
          {/* MODIFIED: Added font-mono and text-6xl for neobrutalism style */}
          {typeof title === 'string' ? <h1 className="text-5xl md:text-6xl font-bold font-mono">{title}</h1> : title}
          {/* MODIFIED: Added font-mono and text-xl for neobrutalism style */}
          {typeof subtitle === 'string' ? <p className="pt-4 md:py-6 text-xl font-mono">{subtitle}</p> : subtitle}
          {children}
        </div>
      </div>
    </div>
  )
}
