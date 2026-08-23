import type { ReactNode } from "react";
import { StructuredData } from "@/components/seo/StructuredData";
import { generateRouteMetadata, getRouteStructuredData } from "@/lib/seo/route-metadata";
import type { RouteKey } from "@/lib/seo/types";

export function createSeoLayout(routeKey: RouteKey) {
  return {
    generateMetadata: () => generateRouteMetadata(routeKey),
    default: async function SeoLayout({ children }: { children: ReactNode }) {
      const structuredData = await getRouteStructuredData(routeKey);
      return (
        <>
          <StructuredData data={structuredData} />
          {children}
        </>
      );
    },
  };
}
