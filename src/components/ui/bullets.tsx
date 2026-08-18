"use client"

import React from "react"

export interface AtomBulletProps extends React.HTMLAttributes<HTMLDivElement> {
  active?: boolean
  interactive?: boolean
  onClick?: () => void
  label?: string
}

/**
 * atom/bullet
 * Pixel-perfect 8px x 8px circular bullet from Penpot design.
 * Active: #02E7F5 (penpot-primary-100)
 * Inactive: #C4C4C4 @ 30% opacity
 */
export function AtomBullet({
  active = false,
  interactive = false,
  onClick,
  label,
  className = "",
  ...props
}: AtomBulletProps) {
  const baseClasses = `size-2 rounded-full transition-colors duration-200 shrink-0 ${
    active ? "bg-penpot-primary-100" : "bg-[#c4c4c4]/30"
  }`

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={active ? "true" : undefined}
        className={`${baseClasses} hover:scale-125 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-penpot-primary-100/50 ${className}`}
        {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      />
    )
  }

  return (
    <div
      aria-hidden="true"
      className={`${baseClasses} ${className}`}
      {...props}
    />
  )
}

export interface MoleculeBulletsProps {
  total: number
  activeIndex: number
  onSelect?: (index: number) => void
  className?: string
}

/**
 * molecule/bullets
 * Row of atom/bullet items with 8px columnGap matching Penpot design
 * (e.g. molecule/bullets/4 or molecule/bullets/2).
 */
export function MoleculeBullets({
  total,
  activeIndex,
  onSelect,
  className = "",
}: MoleculeBulletsProps) {
  const isInteractive = typeof onSelect === "function"

  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      role={isInteractive ? "tablist" : undefined}
      aria-label="Pagination"
    >
      {Array.from({ length: total }).map((_, idx) => (
        <AtomBullet
          key={idx}
          active={idx === activeIndex}
          interactive={isInteractive}
          onClick={isInteractive ? () => onSelect(idx) : undefined}
          label={`Go to page ${idx + 1}`}
        />
      ))}
    </div>
  )
}
