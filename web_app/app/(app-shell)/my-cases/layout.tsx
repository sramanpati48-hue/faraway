import { createSeoLayout } from "@/lib/seo/route-layout";

const seo = createSeoLayout("my-cases");
export const generateMetadata = seo.generateMetadata;
export default seo.default;
