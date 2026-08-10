import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CIDCO AQI Compliance Portal',
  description:
    'City and Industrial Development Corporation — Air Quality Index reporting portal for empanelled architects.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
