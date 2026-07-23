import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mr. Outreach',
  description: 'Panel administrativo de Mr. Outreach, la plataforma de prospección por correo.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-gradient-to-b from-brand-50 via-white to-white text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
