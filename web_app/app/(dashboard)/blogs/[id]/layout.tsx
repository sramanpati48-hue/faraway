import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StructuredData } from "@/components/seo/StructuredData";
import { generateArticleMetadata, getArticleStructuredData } from "@/lib/seo/route-metadata";

type Props = {
  children: ReactNode;
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return generateArticleMetadata(id);
}

export default async function BlogArticleLayout({ children, params }: Props) {
  const { id } = await params;
  const structuredData = await getArticleStructuredData(id);
  return (
    <>
      <StructuredData data={structuredData} />
      {children}
    </>
  );
}
