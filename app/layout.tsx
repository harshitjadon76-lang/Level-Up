
import type { Metadata } from "next";


export const metadata: Metadata = {
  title: "Level Up",
  description: "Level Up - Your personal productivity and progress tracker",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
