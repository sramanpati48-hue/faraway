import { createSeoLayout } from "@/lib/seo/route-layout";

const seo = createSeoLayout("login");
export const generateMetadata = seo.generateMetadata;
export default seo.default;
