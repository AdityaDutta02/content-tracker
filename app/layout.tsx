import './globals.css'
import { ChannelRail } from '@/components/ui/channel-rail'

export const metadata = { title: 'Niche Wire', description: 'Daily AI-curated niche feeds' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-ink font-sans min-h-screen">
        <div className="mx-auto flex max-w-6xl">
          <ChannelRail />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  )
}
