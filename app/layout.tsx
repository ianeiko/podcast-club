import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Podcast Club — Listen closely. Think together.",
  description:
    "A shared listening room for the first 45 minutes of DHH on the Lex Fridman Podcast. Explore the transcript and ask better questions.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
