import { createSeoLayout } from "@/lib/seo/route-layout";

const seo = createSeoLayout("find-help");
export const generateMetadata = seo.generateMetadata;
export default seo.default;
