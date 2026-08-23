import { createSeoLayout } from "@/lib/seo/route-layout";

const seo = createSeoLayout("lawyer-cases");
export const generateMetadata = seo.generateMetadata;
export default seo.default;
