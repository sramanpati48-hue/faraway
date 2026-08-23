import { createSeoLayout } from "@/lib/seo/route-layout";

const seo = createSeoLayout("search");
export const generateMetadata = seo.generateMetadata;
export const dynamic = "force-dynamic";
export default seo.default;
