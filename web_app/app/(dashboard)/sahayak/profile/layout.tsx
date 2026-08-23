import { createSeoLayout } from "@/lib/seo/route-layout";

const seo = createSeoLayout("sahayak-profile");
export const generateMetadata = seo.generateMetadata;
export default seo.default;
