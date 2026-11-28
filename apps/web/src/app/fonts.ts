import { Inter } from 'next/font/google';

// Inter (R-219), downloaded at build time and served from this site: no
// request to Google at runtime. tokens.css puts --font-inter first in
// --font-sans, with the system stack behind it. Shared by the root layout
// and the global error page, which replaces that layout.
export const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
});
