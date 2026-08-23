import { createSeoLayout } from "@/lib/seo/route-layout";

const seo = createSeoLayout("documents");
export const generateMetadata = seo.generateMetadata;
export default seo.default;
