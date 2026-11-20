import type { ComponentType, CSSProperties } from 'react'
import { Briefcase, Folders, GitCompareArrows, Globe, Grid2X2, Inbox, Plus, Terminal } from 'lucide-react'
import type { IconName } from '@kernel/interaction/contract'

export interface IconProps {
  size?: number | string
  className?: string
  style?: CSSProperties
}

const ICONS: Record<IconName, ComponentType<IconProps>> = {
  terminal: Terminal,
  globe: Globe,
  folders: Folders,
  grid: Grid2X2,
  'git-compare': GitCompareArrows,
  plus: Plus,
  briefcase: Briefcase,
  inbox: Inbox,
}

export function Icon({ name, ...props }: IconProps & { name: IconName }) {
  const Component = ICONS[name]
  return <Component {...props} />
}
