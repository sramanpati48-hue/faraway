import { createSeoLayout } from "@/lib/seo/route-layout";

const seo = createSeoLayout("scam-heatmap");
export const generateMetadata = seo.generateMetadata;
export default seo.default;
