import React from 'react'
import { Separator } from '@/components/ui/separator'

export const SettingsSection: React.FC<{
  title: string
  anchorId?: string
  children: React.ReactNode
}> = ({ title, anchorId, children }) => (
  <div id={anchorId} className="space-y-4">
    <div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <Separator className="mt-2" />
    </div>
    {children}
  </div>
)
