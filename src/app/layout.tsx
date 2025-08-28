import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

const nuninto = Nunito({
  subsets: ["latin"],
  display: 'swap'
});


export const metadata: Metadata = {
  title: {
    default: 'Vidchat WebRTC',
    template: '%s · Vidchat WebRTC',
  },
  description: 'Simple video chat using WebRTC with Firestore for signaling.',
  applicationName: 'Vidchat WebRTC',
  robots: { index: true, follow: true },
  icons: { icon: '/favicon.ico' },
  themeColor: '#f4f4f5',
  openGraph: {
    type: 'website',
    title: 'Vidchat WebRTC',
    description: 'Simple video chat using WebRTC with Firestore for signaling.',
    siteName: 'Vidchat WebRTC',
    locale: 'en_US',
    url: '/',
  },
  twitter: {
    card: 'summary',
    title: 'Vidchat WebRTC',
    description: 'Simple video chat using WebRTC with Firestore for signaling.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${nuninto.className} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
