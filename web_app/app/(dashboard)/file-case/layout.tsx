import { createSeoLayout } from "@/lib/seo/route-layout";

const seo = createSeoLayout("file-case");
export const generateMetadata = seo.generateMetadata;
export default seo.default;
