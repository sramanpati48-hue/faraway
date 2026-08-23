import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home | NyaySahayak",
  description: "Your legal assistant workspace — start a case, track formalised matters, and find help.",
  robots: { index: false, follow: false },
};

export default function HomeAppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
