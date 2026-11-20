import type { Metadata } from "next";
import AiUsageDashboard from "@/components/ai-courses/ai-usage-dashboard";
export const metadata: Metadata = { title: "Theo dõi API AI" };
export default function Page() { return <AiUsageDashboard />; }
