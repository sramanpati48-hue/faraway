const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type AboutContent = {
  title?: string;
  tagline?: string;
  mission?: string;
  stats?: { label: string; value: string }[];
  values?: { title: string; description: string }[];
  team?: { name: string; role: string }[];
};

export const ABOUT_FALLBACK: AboutContent = {
  title: "About NyaySahayak",
  tagline: "Justice made accessible for every Indian.",
  mission:
    "NyaySahayak is an AI-powered legal companion that helps citizens understand their rights, navigate the justice system, and connect with verified lawyers and Nyay Guides.",
  stats: [
    { label: "Legal knowledge base", value: "Indexed" },
    { label: "Lawyer network", value: "Growing" },
    { label: "Languages supported", value: "3" },
  ],
  values: [
    { title: "Accessible", description: "Legal help in your language, on any device." },
    { title: "Trustworthy", description: "Grounded in Indian statutes and verified experts." },
    { title: "Empowering", description: "We help you act, not just understand." },
  ],
};

export async function fetchAboutContent(): Promise<AboutContent> {
  try {
    const res = await fetch(`${API_URL}/api/content/about`);
    if (!res.ok) throw new Error(`Failed (${res.status})`);
    const data = await res.json();
    return (data.content as AboutContent) || ABOUT_FALLBACK;
  } catch {
    return ABOUT_FALLBACK;
  }
}
