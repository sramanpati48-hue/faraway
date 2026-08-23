import { dmSans } from "@/lib/fonts";
import { cn } from "@/lib/utils";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className={cn(dmSans.className, "min-h-screen bg-white")}>{children}</div>;
}
