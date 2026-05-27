import { LegalDocument } from '@/components/LegalDocument';

export default function TermsOfServiceScreen() {
  return (
    <LegalDocument
      title="Terms of Service"
      effectiveDate="May 13, 2026"
      intro="These Terms of Service govern your use of the Fan Sphere mobile application. By creating an account or using Fan Sphere, you agree to these terms. This is a draft pending legal review. Before launching publicly, please replace this copy with attorney-reviewed text appropriate for your jurisdiction(s)."
      sections={[
        {
          heading: 'Eligibility',
          body:
            'You must be at least 13 years old to use Fan Sphere. By using the app you represent that you meet this age requirement.',
        },
        {
          heading: 'Your Account',
          body:
            'You are responsible for keeping your account credentials secure and for activity on your account. Notify us immediately at support@thabtech.com if you suspect unauthorised access.',
        },
        {
          heading: 'Acceptable Use',
          body:
            'You agree not to: post hateful, harassing, threatening, or illegal content; impersonate others; spam other users; attempt to scrape or reverse-engineer the service; circumvent rate limits or moderation. We may remove content or suspend accounts that violate these rules.',
        },
        {
          heading: 'Your Content',
          body:
            'You retain ownership of content you create (watch parties, posts, clips, comments). By posting, you grant Fan Sphere a worldwide, royalty-free licence to host, display, and distribute that content within the app. You are responsible for ensuring you have the rights to anything you upload.',
        },
        {
          heading: 'Reporting and Moderation',
          body:
            'Any user can report content or block another user. We review reports and remove content that violates these terms. We may also take action against repeat offenders, including account suspension or permanent removal.',
        },
        {
          heading: 'Third-Party Content',
          body:
            'Game schedules and sports data are sourced from public APIs (e.g., ESPN). We do not own that data and do not guarantee accuracy.',
        },
        {
          heading: 'Disclaimer of Warranties',
          body:
            'Fan Sphere is provided "as is" without warranties of any kind, express or implied. We do not guarantee uninterrupted service.',
        },
        {
          heading: 'Limitation of Liability',
          body:
            'To the maximum extent permitted by law, Fan Sphere is not liable for indirect, incidental, or consequential damages arising from your use of the service.',
        },
        {
          heading: 'Termination',
          body:
            'You may stop using Fan Sphere at any time. We may suspend or terminate your account if you violate these terms.',
        },
        {
          heading: 'Changes to These Terms',
          body:
            'We may update these terms. Material changes will be announced in-app. Continued use after changes constitutes acceptance.',
        },
        {
          heading: 'Governing Law',
          body:
            'These terms are governed by the laws of the jurisdiction in which Fan Sphere is incorporated. (Replace with specific governing-law clause during legal review.)',
        },
      ]}
    />
  );
}
