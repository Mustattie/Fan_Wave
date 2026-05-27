import { LegalDocument } from '@/components/LegalDocument';

export default function PrivacyPolicyScreen() {
  return (
    <LegalDocument
      title="Privacy Policy"
      effectiveDate="May 13, 2026"
      intro={'This Privacy Policy describes how Fan Sphere ("we", "us") collects, uses, and shares information when you use our mobile application. This is a draft policy pending legal review. Before launching publicly, please replace this copy with attorney-reviewed text appropriate for your jurisdiction(s).'}
      sections={[
        {
          heading: 'Information We Collect',
          body:
            'Account information you provide (display name, email, password, optional profile photo, sports interests, followed teams, home city). Content you create (watch parties, posts, clips, group messages, RSVPs, reports). Device information (device model, OS version, push notification token). Location data (only when you grant permission, used to surface nearby watch parties).',
        },
        {
          heading: 'How We Use Information',
          body:
            'To operate Fan Sphere: authenticate you, show relevant watch parties and groups, deliver push notifications, and connect you with other fans. To improve the service: aggregate usage analytics, debug crashes via Sentry. To enforce safety: review reported content, block abusive accounts. We do not sell your personal information.',
        },
        {
          heading: 'Information You Share With Others',
          body:
            'Your display name, profile photo, posts, clips, watch parties, and group messages are visible to other Fan Sphere users according to your visibility settings. Private watch parties are only visible to invitees you specify.',
        },
        {
          heading: 'Third-Party Services',
          body:
            'We use Supabase for backend hosting, Expo for push notifications, Sentry for error reporting, and ESPN public APIs for sports schedules. Each provider has its own privacy practices.',
        },
        {
          heading: 'Data Retention and Deletion',
          body:
            'You can delete your account at any time from Profile → Sign Out → Delete Account (coming soon — until then, email support@fansphere.org and we will delete your account within 30 days). Deletion removes your profile, posts, clips, RSVPs, and group memberships. Aggregated analytics may be retained in anonymised form.',
        },
        {
          heading: 'Children',
          body:
            'Fan Sphere is intended for users 13 and older. We do not knowingly collect information from children under 13. If you believe a child has provided us information, contact support@fansphere.org.',
        },
        {
          heading: 'Your Rights',
          body:
            'Depending on your jurisdiction, you may have rights to access, correct, port, or delete your personal data. To exercise these rights, contact support@fansphere.org.',
        },
        {
          heading: 'Changes to This Policy',
          body:
            'We may update this policy. When we do, we will update the "Effective" date above and notify you in-app for material changes.',
        },
      ]}
    />
  );
}
