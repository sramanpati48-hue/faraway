/** Fallback mock data when APIs are unavailable — realistic Indian legal context. */

export type FilingTemplateOption = {
  id: string;
  title: string;
  category: string;
  action_prompt: string;
};

export const FALLBACK_FILING_TEMPLATES: FilingTemplateOption[] = [
  {
    id: "file-fir",
    title: "File an FIR",
    category: "Criminal",
    action_prompt:
      "I need help filing an FIR in India. Guide me step by step: jurisdiction vs Zero FIR, what to write in the complaint, getting a free FIR copy, and what to do if police refuse.",
  },
  {
    id: "consumer-complaint-filing",
    title: "File a Consumer Complaint",
    category: "Consumer",
    action_prompt:
      "Help me file a consumer complaint in India. Guide me on sending a written notice to the seller, choosing District/State/National Commission, drafting facts and relief sought, fees, and documents I need.",
  },
  {
    id: "cyber-crime-report",
    title: "Report a Cyber Crime",
    category: "Cyber",
    action_prompt:
      "I need to report a cyber crime in India. Guide me through cybercrime.gov.in, helpline 1930 for financial fraud, informing my bank, and what evidence to preserve.",
  },
  {
    id: "domestic-violence-complaint",
    title: "File a Domestic Violence Complaint",
    category: "Family",
    action_prompt:
      "Help me file a domestic violence complaint under the PWDV Act. Explain Protection Officer / police / magistrate options, protection and residence orders, interim relief, and free legal aid.",
  },
  {
    id: "motor-accident-claim",
    title: "File a Motor Accident Claim",
    category: "Motor",
    action_prompt:
      "Guide me through filing a motor accident compensation claim before the MACT in India, including FIR, documents, petition drafting, and hearings.",
  },
  {
    id: "cheque-bounce-case",
    title: "File a Cheque Bounce Case",
    category: "Criminal",
    action_prompt:
      "Help me file a cheque bounce case under Section 138 NI Act. Walk me through the demand notice timeline, waiting period, complaint filing, and required documents.",
  },
  {
    id: "rti-filing",
    title: "File an RTI Application",
    category: "Governance",
    action_prompt:
      "Help me file an RTI application in India. Guide me on identifying the PIO, drafting specific questions, fee payment, 30-day response, and first appeal.",
  },
];

export type SidebarCaseSession = {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
  pinned?: boolean;
};

export const MOCK_SIDEBAR_SESSIONS: SidebarCaseSession[] = [
  {
    id: "mock-session-1",
    title: "Online fraud — UPI scam",
    preview: "Lost ₹45,000 via fake customer support link…",
    updated_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    pinned: true,
  },
  {
    id: "mock-session-2",
    title: "Tenant eviction notice",
    preview: "Landlord served 15-day notice without proper grounds…",
    updated_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "mock-session-3",
    title: "Workplace harassment",
    preview: "Documenting repeated harassment and HR inaction…",
    updated_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: "mock-session-4",
    title: "Consumer refund — defective phone",
    preview: "Brand refusing warranty replacement after 4 visits…",
    updated_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: "mock-session-5",
    title: "Cheque bounce — business payment",
    preview: "Supplier cheque returned; need Section 138 steps…",
    updated_at: new Date(Date.now() - 8 * 86400000).toISOString(),
  },
];

export type TrackingCase = {
  id: string;
  title: string;
  status: string;
  statusTone: "amber" | "emerald" | "blue" | "slate";
  nextStep: string;
  updated: string;
  involved: string;
};

export const MOCK_TRACKING_CASES: TrackingCase[] = [
  {
    id: "fc-101",
    title: "Cyber fraud — UPI scam (₹45,000)",
    status: "Under NyayGuide review",
    statusTone: "blue",
    nextStep: "Sahayak verifying transaction records and drafting complaint summary.",
    updated: "2 hours ago",
    involved: "NyayGuide · Moderator queue",
  },
  {
    id: "fc-102",
    title: "Consumer complaint — e-commerce refund",
    status: "Tracking with Sahayak",
    statusTone: "emerald",
    nextStep: "Legal notice draft ready; awaiting your approval to send.",
    updated: "Yesterday",
    involved: "Sahayak assigned",
  },
  {
    id: "fc-103",
    title: "Domestic violence — protection order",
    status: "Pending moderator review",
    statusTone: "amber",
    nextStep: "Moderator reviewing sensitive details before lawyer referral.",
    updated: "3 days ago",
    involved: "Moderator · NyayGuide",
  },
];

export const URGENT_HELPLINES = [
  { label: "Emergency (Police / Fire / Ambulance)", number: "112", note: "All India" },
  { label: "Women Helpline", number: "181", note: "24×7" },
  { label: "Cyber Crime & financial fraud", number: "1930", note: "Report at cybercrime.gov.in" },
  { label: "National Legal Services (NALSA)", number: "15100", note: "Free legal aid" },
];

export const LEGAL_LIBRARY_LINKS = [
  {
    href: "/documents",
    title: "Documents & templates",
    desc: "Affidavits, notices, complaint formats",
  },
  {
    href: "/legal-rights",
    title: "Know your rights",
    desc: "Consumer, workplace, property, criminal basics",
  },
  {
    href: "/legal-rights#acts",
    title: "Important Acts",
    desc: "IPC/BNS, DV Act, Consumer Protection, IT Act",
  },
];
