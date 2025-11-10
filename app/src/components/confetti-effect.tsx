// src/components/confetti-effect.tsx
'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'

type ConfettiPiece = {
  id: number
  style: React.CSSProperties
}

const CONFETTI_COLORS = ['var(--primary)', 'var(--destructive)', '#FFFF00']
const CONFETTI_COUNT = 30

export function ConfettiEffect() {
  const [pieces, setPieces] = useState<ConfettiPiece[]>([])
  const idCounter = useRef(0)

  const triggerConfetti = useCallback(() => {
    const newPieces: ConfettiPiece[] = []

    // MODIFIED: Simplified ID logic to fix the bug
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const newId = idCounter.current++ // Just increment the ref, simple and effective
      newPieces.push({
        id: newId,
        style: {
          left: `${Math.random() * 100}vw`,
          backgroundColor: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
          animationDelay: `${Math.random() * 0.3}s`,
          transform: `rotate(${Math.random() * 360}deg)`,
        },
      })
    }

    setPieces((prev) => [...prev, ...newPieces])

    // Remove the pieces after the animation is done (5 seconds)
    setTimeout(() => {
      setPieces((prev) => prev.filter((p) => !newPieces.some((np) => np.id === p.id)))
    }, 5000)
  }, []) // Empty dependency array is correct

  useEffect(() => {
    document.addEventListener('newBuy', triggerConfetti)
    return () => {
      document.removeEventListener('newBuy', triggerConfetti)
    }
  }, [triggerConfetti])

  return (
    <div className="pointer-events-none fixed inset-0 z-[300] overflow-hidden">
      {pieces.map((piece) => (
        <div key={piece.id} className="confetti-piece" style={piece.style} />
      ))}
    </div>
  )
}
