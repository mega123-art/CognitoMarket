'use client'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Menu, X } from 'lucide-react'
import { ThemeSelect } from '@/components/theme-select'
import { ClusterUiSelect } from './cluster/cluster-ui'
import { WalletButton } from '@/components/solana/solana-provider'
import { cn } from '@/lib/utils' // Import cn

export function AppHeader({ links = [] }: { links: { label: string; path: string }[] }) {
  const pathname = usePathname()
  const [showMenu, setShowMenu] = useState(false)

  function isActive(path: string) {
    return path === '/' ? pathname === '/' : pathname.startsWith(path)
  }

  return (
    // MODIFIED: Applied bg-background, border-b-2, border-foreground, and a bottom shadow for neobrutalism
    <header className="relative z-50 px-4 py-2 bg-background border-b-2 border-foreground shadow-[0px_4px_0px_var(--border)]">
      <div className="mx-auto flex justify-between items-center">
        <div className="flex items-baseline gap-4">
          {/* MODIFIED: Added font-bold, font-mono, and hover styles for the title */}
          <Link
            className="text-xl font-bold font-mono hover:bg-primary hover:text-primary-foreground px-2 -ml-2"
            href="/"
          >
            <span>Cognitomarket</span>
          </Link>
          <div className="hidden md:flex items-center">
            <ul className="flex gap-4 flex-nowrap items-center">
              {links.map(({ label, path }) => (
                <li key={path}>
                  {/* MODIFIED: Styled links to match neobrutalism active/hover states */}
                  <Link
                    className={cn(
                      'font-semibold font-mono px-2 py-1',
                      isActive(path)
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                    href={path}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* MODIFIED: Changed variant to "outline" to match other brutalist buttons */}
        <Button variant="outline" size="icon" className="md:hidden" onClick={() => setShowMenu(!showMenu)}>
          {showMenu ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </Button>

        <div className="hidden md:flex items-center gap-4">
          <WalletButton />
          <ClusterUiSelect />
          <ThemeSelect />
        </div>

        {/* MODIFIED: Replaced transparent/blur background with solid bg-background and border */}
        {showMenu && (
          <div className="md:hidden fixed inset-x-0 top-[54px] bottom-0 bg-background border-t-2 border-foreground">
            {/* MODIFIED: Removed redundant border class */}
            <div className="flex flex-col p-4 gap-4">
              <ul className="flex flex-col gap-4">
                {links.map(({ label, path }) => (
                  <li key={path}>
                    {/* MODIFIED: Styled mobile links to match neobrutalism active/hover states */}
                    <Link
                      className={cn(
                        'font-semibold font-mono block text-lg py-2 px-2',
                        isActive(path)
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-accent hover:text-accent-foreground',
                      )}
                      href={path}
                      onClick={() => setShowMenu(false)}
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-4">
                <WalletButton />
                <ClusterUiSelect />
                <ThemeSelect />
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
