import { createSeoLayout } from "@/lib/seo/route-layout";

const seo = createSeoLayout("clash");
export const generateMetadata = seo.generateMetadata;
export default seo.default;
