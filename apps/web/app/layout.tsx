import type { ReactNode } from 'react';

export const metadata = {
  title: 'PhotoChase',
  description: 'A multi-team, location-based photo chase game.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
