import './globals.css'
import Link from 'next/link'

export const metadata = { title: 'Content Tracker', description: 'Daily ranked feeds per niche' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="inner">
            <div className="brand"><Link href="/">Content Tracker</Link></div>
            <div className="tag">Daily · Ranked · Per niche</div>
          </div>
        </header>
        {children}
      </body>
    </html>
  )
}
