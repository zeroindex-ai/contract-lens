import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lens · ZeroIndex',
  description: 'Structured PDF extraction with verified citations. Document intelligence demo for ZeroIndex.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>

        <header id="siteHeader" className="site-header sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-6 md:px-10 py-5 flex items-center justify-between">
            <a href="https://zeroindex.ai" className="brand-link" aria-label="ZeroIndex home">
              <span className="brand-name">ZeroIndex</span>
            </a>
            <a href="https://zeroindex.ai" className="text-sm muted hover:opacity-80 transition-opacity">
              &larr; zeroindex.ai
            </a>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-6 md:px-10">
          <main id="main-content">{children}</main>

          <footer className="border-t line py-10 text-sm">
            <div className="muted flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
              <div className="mono">&copy; 2026 ZeroIndex LLC &middot; Pennsylvania</div>
              <div className="flex items-center gap-6">
                <a className="subtle" href="https://github.com/zeroindex-ai/contract-lens">
                  Source
                </a>
                <a className="subtle" href="https://evals.zeroindex.ai">
                  Evals
                </a>
                <a className="subtle" href="https://traces.zeroindex.ai">
                  Traces
                </a>
                <a className="subtle" href="https://zeroindex.ai">
                  zeroindex.ai
                </a>
              </div>
            </div>
          </footer>
        </div>

        <Script id="sticky-header-listener" strategy="afterInteractive">
          {`(function(){var h=document.getElementById('siteHeader');if(!h)return;function f(){h.classList.toggle('scrolled',window.scrollY>4)}window.addEventListener('scroll',f,{passive:true});f()})();`}
        </Script>
      </body>
    </html>
  );
}
