// src/components/floating-buy-elements.tsx
'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'

type FloatingElement = {
  id: number
  x: number
  y: number
  type: 'yes' | 'no'
}

export function FloatingBuyElements() {
  const [elements, setElements] = useState<FloatingElement[]>([])
  const elementIdCounter = useRef(0)

  const addElement = useCallback((event: Event) => {
    const detail = (event as CustomEvent).detail
    // MODIFIED: Safely check the type. Default to 'no' if it's not 'yes'.
    const type = detail?.type === 'yes' ? 'yes' : 'no'
    const newId = elementIdCounter.current++

    const newElement: FloatingElement = {
      id: newId,
      x: Math.random() * 90,
      y: Math.random() * 40 + 30,
      type, // This will now be correctly 'yes' or 'no'
    }

    setElements((prev) => [...prev, newElement])

    setTimeout(() => {
      setElements((prev) => prev.filter((el) => el.id !== newId))
    }, 3000)
  }, [])

  useEffect(() => {
    document.addEventListener('newBuy', addElement)
    return () => {
      document.removeEventListener('newBuy', addElement)
    }
  }, [addElement])

  return (
    <div className="pointer-events-none fixed inset-0 z-[200] overflow-hidden">
      {elements.map((el) => (
        <div
          key={el.id}
          className={`floating-element ${
            // This logic is now safe
            el.type === 'yes' ? 'floating-yes' : 'floating-no'
          }`}
          style={{
            left: `${el.x}vw`,
            top: `${el.y}vh`,
          }}
        >
          {el.type.toUpperCase()}
        </div>
      ))}
    </div>
  )
}
