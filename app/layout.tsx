import './globals.css'

export const metadata = { title: 'Content Tracker', description: 'Daily ranked feeds per niche' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
