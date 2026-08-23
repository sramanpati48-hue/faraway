import type { Metadata } from "next";
import { LegalSection, MarketingLegalShell } from "@/components/landing/MarketingLegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy · NyaySahayak",
  description: "How NyaySahayak handles account data, conversations, and sensitive case escalations.",
};

export default function PrivacyPage() {
  return (
    <MarketingLegalShell title="Privacy Policy" updated="24 July 2026">
      <LegalSection title="Who we are">
        <p>
          NyaySahayak (“we”) provides an AI-assisted legal companion for people in India seeking guidance,
          next steps, and connections to human help. We are not a law firm.
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <p>Depending on how you use the product, we may process:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Account details such as email, phone, and authentication credentials</li>
          <li>Case conversations, attachments you upload, and related session history</li>
          <li>Technical logs needed to operate and secure the service</li>
          <li>Optional location or area information when you provide it for routing</li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use information">
        <p>We use data to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Provide guidance, drafts, and case continuity across sessions</li>
          <li>Route matters to specialist AI paths and, when needed, human helpers</li>
          <li>Improve reliability, safety, and product quality</li>
          <li>Comply with law and protect users from abuse or harm</li>
        </ul>
      </LegalSection>

      <LegalSection title="Human review and escalation">
        <p>
          Sensitive or escalated cases may be reviewed by trained moderators, Nyay Guides (Sahayaks), or
          connected lawyers so you can receive appropriate help. Escalation is intended for your safety and
          continuity — not for marketing use of your story.
        </p>
      </LegalSection>

      <LegalSection title="Sharing">
        <p>
          We do not sell your personal information. We may share data with service providers who help us run
          the product (for example hosting, authentication, or document storage), and with humans you choose
          to connect with (such as a lawyer or Nyay Guide). We may disclose information when required by law
          or to protect critical safety interests.
        </p>
      </LegalSection>

      <LegalSection title="Retention">
        <p>
          We keep account and case data while your account is active and for a reasonable period afterward as
          needed for security, disputes, or legal obligations. You may request deletion of your account
          subject to those limits.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          We use access controls and industry-standard practices to protect data in transit and at rest where
          our infrastructure supports it. No method of transmission or storage is perfectly secure.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          The service is not directed at children. If you believe a minor’s data was provided, contact us so
          we can take appropriate action.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          For privacy questions, use the contact channels published on the About page or in-product help. This
          policy may be updated as the product evolves; the “Last updated” date above will change when it
          does.
        </p>
      </LegalSection>
    </MarketingLegalShell>
  );
}
