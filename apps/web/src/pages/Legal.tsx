import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

type LegalDoc = 'terms' | 'privacy' | 'cookies' | 'dmca' | 'age-policy';

interface Props {
  onSignIn: () => void;
}

interface DocMeta {
  title: string;
  icon: string;
  updated: string;
  intro: string;
}

const DOC_META: Record<LegalDoc, DocMeta> = {
  'terms': {
    title: 'Terms of Service',
    icon: '📜',
    updated: 'October 4, 2026',
    intro: 'These terms govern your use of Melodyflix. By accessing or using the platform, you agree to be bound by these terms.',
  },
  'privacy': {
    title: 'Privacy Policy',
    icon: '🔒',
    updated: 'October 4, 2026',
    intro: 'This policy explains what data we collect, how we use it, and the rights you have over your information.',
  },
  'cookies': {
    title: 'Cookie Policy',
    icon: '🍪',
    updated: 'October 4, 2026',
    intro: 'This policy explains how Melodyflix uses cookies and similar technologies to recognize you and improve your experience.',
  },
  'dmca': {
    title: 'DMCA / Copyright Policy',
    icon: '©️',
    updated: 'October 4, 2026',
    intro: 'Melodyflix respects the intellectual property rights of others. This policy describes our copyright takedown procedure.',
  },
  'age-policy': {
    title: 'Age Policy',
    icon: '👶',
    updated: 'October 4, 2026',
    intro: 'This policy explains age requirements for using Melodyflix, plus parental controls and children\'s privacy protections.',
  },
};

const CONTENT: Record<LegalDoc, string[]> = {
  'terms': [
    '## 1. Acceptance of Terms',
    'By creating an account or using Melodyflix ("the Service"), you agree to these Terms of Service. If you do not agree, do not use the Service.',
    '## 2. Eligibility',
    'You must be at least 13 years old (or the minimum digital consent age in your country, whichever is higher) to create an account. Users under 18 must have parental consent. See our Age Policy for details.',
    '## 3. Your Account',
    'You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. Notify us immediately of any unauthorized use.',
    '## 4. Acceptable Use',
    'You agree not to:',
    '• Upload or share content that infringes copyright, trademarks, or other rights',
    '• Post hate speech, harassment, or content that incites violence',
    '• Upload malware, spam, or deceptive content',
    '• Attempt to gain unauthorized access to our systems',
    '• Use automated tools to scrape or overload the Service',
    '• Impersonate others or misrepresent your affiliation',
    '## 5. User Content',
    'You retain ownership of content you upload. By uploading, you grant Melodyflix a worldwide, non-exclusive, royalty-free license to host, display, distribute, and promote your content on the Service.',
    'You represent that you have all necessary rights to the content you upload.',
    '## 6. Copyright and DMCA',
    'We respond to valid DMCA notices. See our DMCA Policy for the full takedown procedure.',
    '## 7. Monetization',
    'Eligible creators may earn revenue through ads, memberships, tips, and other monetization features. Payout terms, minimum thresholds, and tax obligations are described in the Creator Agreement (provided separately).',
    '## 8. Payments and Refunds',
    'Payments are processed through third-party providers (bKash, Nagad, Stripe, etc.). Refunds are issued at our discretion in accordance with local consumer protection laws.',
    '## 9. Termination',
    'We may suspend or terminate your account for violation of these terms. You may delete your account at any time.',
    '## 10. Disclaimers',
    'The Service is provided "as is" without warranties of any kind. We do not guarantee uninterrupted availability or error-free operation.',
    '## 11. Limitation of Liability',
    'To the maximum extent permitted by law, Melodyflix shall not be liable for indirect, incidental, or consequential damages arising from your use of the Service.',
    '## 12. Governing Law',
    'These terms are governed by the laws of Bangladesh, without regard to conflict of law principles.',
    '## 13. Changes to Terms',
    'We may update these terms. Material changes will be notified by email or in-app notice. Continued use after changes constitutes acceptance.',
    '## 14. Contact',
    'Questions about these terms? Email legal@melodyflix.com.',
  ],
  'privacy': [
    '## 1. Introduction',
    'Melodyflix is committed to protecting your privacy. This policy describes the personal data we collect, how we use it, and your rights.',
    '## 2. Data We Collect',
    '**Account data:** name, email, username, password hash, profile info.',
    '**Usage data:** videos watched, search queries, likes, comments, watch history.',
    '**Device data:** IP address, browser/OS, device identifiers, approximate location (from IP).',
    '**Payment data:** processed by third-party providers; we store only transaction IDs, not full card numbers.',
    '**Content:** videos, comments, messages you upload or send.',
    '## 3. How We Use Your Data',
    '• To provide and improve the Service',
    '• To personalize recommendations',
    '• To process payments and prevent fraud',
    '• To send service notifications and (with consent) marketing emails',
    '• To comply with legal obligations',
    '## 4. Legal Basis (GDPR)',
    'For EU/UK users, our legal bases are: contract performance (core service), legitimate interest (safety, improvement), consent (marketing), and legal obligation.',
    '## 5. Data Sharing',
    'We do not sell your personal data. We share with:',
    '• Payment processors (as needed for transactions)',
    '• Cloud infrastructure providers (AWS, Oracle, Cloudflare)',
    '• Analytics providers (with anonymized data)',
    '• Law enforcement (only when legally required)',
    '## 6. Data Retention',
    'Account data is retained while your account is active. After deletion, we retain certain data for up to 90 days for legal/security purposes, then anonymize or delete it.',
    '## 7. Your Rights',
    'You have the right to: access, correct, delete, restrict, or port your data. You may also object to processing or withdraw consent. Contact privacy@melodyflix.com to exercise these rights.',
    '## 8. Security',
    'We use industry-standard security: TLS encryption, hashed passwords, encrypted databases, rate limiting, and regular audits. No system is 100% secure — report issues to security@melodyflix.com.',
    '## 9. International Transfers',
    'Your data may be processed outside your country. We use Standard Contractual Clauses and equivalent safeguards.',
    '## 10. Children',
    'We do not knowingly collect data from children under 13 (or the applicable age in your jurisdiction). See our Age Policy.',
    '## 11. Changes',
    'We may update this policy. Material changes will be notified. Continued use constitutes acceptance.',
    '## 12. Contact',
    'Data Protection Officer: privacy@melodyflix.com.',
  ],
  'cookies': [
    '## 1. What Are Cookies?',
    'Cookies are small text files stored on your device that help websites remember your preferences and activity.',
    '## 2. Cookies We Use',
    '**Strictly necessary:** authentication tokens, CSRF protection, session state. These cannot be disabled.',
    '**Functional:** language preference, theme (light/dark), player settings.',
    '**Analytics:** anonymous usage statistics to understand how the Service is used.',
    '**Marketing:** ad personalization (only with your consent).',
    '## 3. Third-Party Cookies',
    'We use cookies from: Google Analytics (anonymized), Stripe/bKash (payment), Cloudflare (security).',
    '## 4. Managing Cookies',
    'You can control cookies through your browser settings. Disabling cookies may break parts of the Service. A consent banner appears on first visit for EU/UK users.',
    '## 5. Do Not Track',
    'We honor the DNT browser header for users who set it.',
    '## 6. Updates',
    'This policy may be updated. Check back periodically.',
    '## 7. Contact',
    'privacy@melodyflix.com.',
  ],
  'dmca': [
    '## 1. Our Commitment',
    'Melodyflix respects intellectual property rights and responds promptly to valid copyright complaints under the Digital Millennium Copyright Act (DMCA) and equivalent laws worldwide.',
    '## 2. Filing a Takedown Notice',
    'Send written notice to dmca@melodyflix.com including:',
    '• Your physical or electronic signature',
    '• Identification of the copyrighted work claimed to be infringed',
    '• Identification of the infringing material (URL on our Service)',
    '• Your contact information (address, phone, email)',
    '• A statement that you have a good-faith belief the use is unauthorized',
    '• A statement, under penalty of perjury, that the information is accurate and you are authorized to act',
    '## 3. Our Response',
    'We will:',
    '• Acknowledge receipt within 2 business days',
    '• Remove or disable access to the material within 5 business days if the notice is valid',
    '• Notify the uploader of the takedown',
    '• Provide the uploader an opportunity to file a counter-notice',
    '## 4. Counter-Notice',
    'If your content was removed in error, you may file a counter-notice to dmca@melodyflix.com. We will forward it to the original complainant and restore the content after 10-14 business days unless legal action is filed.',
    '## 5. Repeat Infringers',
    'Accounts with three valid DMCA strikes are terminated.',
    '## 6. False Claims',
    'Knowingly filing a false DMCA claim may result in legal liability, including damages and attorney fees.',
    '## 7. Copyright Agent',
    'Melodyflix Copyright Agent, dmca@melodyflix.com.',
  ],
  'age-policy': [
    '## 1. Minimum Age',
    'You must be at least 13 years old to create a Melodyflix account. In countries with higher digital consent ages (e.g. 16 in parts of EU), that age applies.',
    '## 2. Parental Consent',
    'Users aged 13-17 must have parental or guardian consent. Parents may review, manage, or delete their child\'s account at any time.',
    '## 3. Kids Profiles',
    'Parents can create kids profiles with:',
    '• Age-appropriate content only (max_age_rating filter)',
    '• PIN lock',
    '• Daily screen-time limits',
    '• Approval required for new content',
    '• Parent-teacher messaging (for educational use)',
    '## 4. COPPA Compliance',
    'For US users under 13, we comply with the Children\'s Online Privacy Protection Act (COPPA). We do not collect personal information from children under 13 without verifiable parental consent. Parents may contact privacy@melodyflix.com to review or delete such data.',
    '## 5. Age-Restricted Content',
    'Content rated 18+ requires age verification. Users must confirm they are 18+ via:',
    '• Self-declaration (low-risk content)',
    '• Government-issued ID (high-risk content, where required)',
    '• Payment method on file (as an additional signal)',
    '## 6. Content Ratings',
    'We use a rating system similar to MPAA/PEGI: G, PG, PG-13, R, 18+. Parents can set maximum allowed rating per profile.',
    '## 7. Reporting Concerns',
    'Report content that endangers minors or violates this policy to safety@melodyflix.com. Reports are treated with priority.',
    '## 8. Updates',
    'This policy may be updated to reflect legal changes. Check back periodically.',
    '## 9. Contact',
    'safety@melodyflix.com.',
  ],
};

export default function Legal({ onSignIn: _onSignIn }: Props) {
  const navigate = useNavigate();
  const params = useParams<{ doc?: string }>();
  const docKey = (params.doc || 'terms') as LegalDoc;
  const [activeDoc, setActiveDoc] = useState<LegalDoc>(
    DOC_META[docKey] ? docKey : 'terms'
  );

  useEffect(() => {
    if (DOC_META[docKey]) setActiveDoc(docKey);
  }, [docKey]);

  const meta = DOC_META[activeDoc];
  const lines = CONTENT[activeDoc];

  function renderLine(line: string, idx: number) {
    if (line.startsWith('## ')) {
      return (
        <h2 key={idx} style={{ fontSize: 20, marginTop: 28, marginBottom: 12, color: '#0f0f0f' }}>
          {line.slice(3)}
        </h2>
      );
    }
    if (line.startsWith('**') && line.endsWith('**')) {
      return (
        <p key={idx} style={{ fontSize: 14, marginBottom: 8, color: '#0f0f0f', fontWeight: 600 }}>
          {line.slice(2, -2)}
        </p>
      );
    }
    if (line.startsWith('•')) {
      return (
        <div key={idx} style={{ fontSize: 14, color: '#0f0f0f', marginLeft: 20, marginBottom: 6 }}>
          {line}
        </div>
      );
    }
    return (
      <p key={idx} style={{ fontSize: 14, color: '#0f0f0f', lineHeight: 1.7, marginBottom: 10 }}>
        {line}
      </p>
    );
  }

  return (
    <div className="mf-container" style={{ maxWidth: 900, marginTop: 20, marginBottom: 60 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#0f0f0f' }}
        >
          ←
        </button>
        <div style={{ fontSize: 34 }}>{meta.icon}</div>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>{meta.title}</h1>
          <div style={{ color: '#606060', fontSize: 13 }}>Last updated: {meta.updated}</div>
        </div>
      </div>

      {/* Doc switcher tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24, borderBottom: '1px solid #e5e5e5', flexWrap: 'wrap' }}>
        {(Object.keys(DOC_META) as LegalDoc[]).map((k) => (
          <button
            key={k}
            onClick={() => { setActiveDoc(k); navigate(`/legal/${k}`, { replace: true }); }}
            style={{
              padding: '10px 14px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeDoc === k ? '2px solid #065fd4' : '2px solid transparent',
              color: activeDoc === k ? '#065fd4' : '#606060',
              fontWeight: activeDoc === k ? 600 : 400,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {DOC_META[k].icon} {DOC_META[k].title}
          </button>
        ))}
      </div>

      <div style={{ padding: 20, background: '#f9f9f9', borderRadius: 8, marginBottom: 24, borderLeft: '3px solid #065fd4' }}>
        <p style={{ fontSize: 14, color: '#0f0f0f', lineHeight: 1.7, margin: 0 }}>
          {meta.intro}
        </p>
      </div>

      <div>{lines.map((line, i) => renderLine(line, i))}</div>

      <div style={{ marginTop: 40, padding: 20, background: '#f0f4ff', borderRadius: 8, fontSize: 13, color: '#065fd4' }}>
        This document is provided as a template and does not constitute legal advice.
        For jurisdiction-specific compliance, consult a qualified lawyer.
      </div>
    </div>
  );
}
