import { createSeoLayout } from "@/lib/seo/route-layout";

const seo = createSeoLayout("legal-rights");
export const generateMetadata = seo.generateMetadata;
export default seo.default;
