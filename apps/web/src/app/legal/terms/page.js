import { DocTitle, Lead, Section, P, UL, LI, Strong, A, Callout, SUPPORT_EMAIL } from '../_ui';

export const metadata = {
  title: 'Terms of Service — MiniMe',
  description: 'The terms that govern your use of MiniMe.',
};

export default function TermsOfService() {
  return (
    <article>
      <DocTitle>Terms of Service</DocTitle>

      <Lead>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of MiniMe. By signing up for or
        using MiniMe, you agree to these Terms. If you do not agree, do not use the service.
      </Lead>

      <Section n={1} title="The service">
        <P>MiniMe is an AI assistant that helps business owners respond to customer messages, manage orders, and
        collect payments across Telegram, WhatsApp, and Instagram. Features may change, improve, or be discontinued
        over time.</P>
      </Section>

      <Section n={2} title="Eligibility and accounts">
        <UL>
          <LI>You must be at least 18 years old and operating a legitimate business.</LI>
          <LI>You are responsible for the accuracy of the information you provide and for keeping your account credentials secure.</LI>
          <LI>You are responsible for all activity that occurs under your account.</LI>
        </UL>
      </Section>

      <Section n={3} title="How AI replies work — your responsibility">
        <Callout>
          MiniMe sends messages on your behalf and in your voice. AI-generated replies can be inaccurate,
          incomplete, or inappropriate for a given situation. <Strong>You are responsible for every message sent
          from your connected accounts</Strong>, including AI-generated ones.
        </Callout>
        <UL>
          <LI>Review important replies — especially prices, commitments, order confirmations, and legal or medical matters — before relying on them.</LI>
          <LI>MiniMe does not guarantee that any reply is correct, and is not a substitute for your own judgement.</LI>
          <LI>You can adjust the assistant&rsquo;s behaviour, pause auto-replies, or take over a chat at any time.</LI>
        </UL>
      </Section>

      <Section n={4} title="Your customers&rsquo; data">
        <P>When you connect a channel, you direct MiniMe to process messages from the people who contact you. You
        are responsible for having any notice or consent required by law to let an automated assistant read and
        reply to those messages, and for complying with the rules of the platforms you connect (Telegram, Meta).</P>
        <P>Independent of what you separately provide, MiniMe gives every customer a baseline self-service channel
        of their own — they can message the bot to see or delete what MiniMe holds about them (see our{' '}
        <A href="/legal/privacy">Privacy Policy</A>, Section 9). This does not replace your own obligations as data
        controller.</P>
      </Section>

      <Section n={5} title="Acceptable use">
        <P>You agree not to use MiniMe to:</P>
        <UL>
          <LI>Break the law or facilitate fraud, scams, or deceptive practices.</LI>
          <LI>Send spam or unsolicited bulk messages, or violate platform messaging policies.</LI>
          <LI>Harass, threaten, or harm others, or distribute malicious or illegal content.</LI>
          <LI>Attempt to reverse-engineer, disrupt, overload, or gain unauthorised access to the service.</LI>
          <LI>Impersonate others or misrepresent your affiliation in a harmful or unlawful way.</LI>
        </UL>
      </Section>

      <Section n={6} title="Payments, subscriptions, and trials">
        <UL>
          <LI>MiniMe may offer free trials and paid subscription plans. Pricing and plan details are shown in the app.</LI>
          <LI>Subscriptions are billed in advance on a recurring basis until cancelled. Payment is processed by Chapa.</LI>
          <LI>Order payments your customers make are processed through Chapa and are a transaction between you and your customer; MiniMe is not a party to that sale.</LI>
          <LI>Refunds and cancellations are described in our <A href="/legal/refunds">Refund &amp; Cancellation Policy</A>.</LI>
        </UL>
      </Section>

      <Section n={7} title="Third-party services">
        <P>MiniMe depends on third-party platforms and providers (including Telegram, Meta, OpenAI, Hasab,
        Supabase, Vercel, and Chapa). We are not responsible for their availability, actions, or policies, and your
        use of those platforms is subject to their own terms.</P>
      </Section>

      <Section n={8} title="Intellectual property">
        <P>MiniMe and its software, branding, and content are owned by us or our licensors. You retain ownership of
        your business content and data. You grant us the limited rights needed to operate the service for you, as
        described in our <A href="/legal/privacy">Privacy Policy</A>.</P>
      </Section>

      <Section n={9} title="Suspension and termination">
        <P>You may stop using MiniMe and delete your account at any time. We may suspend or terminate access if you
        breach these Terms, create risk or legal exposure, or use the service in a way that harms others or the
        platforms we connect to. On termination, the data-deletion process in our{' '}
        <A href="/legal/privacy">Privacy Policy</A> applies.</P>
      </Section>

      <Section n={10} title="Disclaimers">
        <P>MiniMe is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind,
        whether express or implied, including fitness for a particular purpose and non-infringement. We do not
        warrant that the service will be uninterrupted, error-free, or that AI output will be accurate.</P>
      </Section>

      <Section n={11} title="Limitation of liability">
        <P>To the maximum extent permitted by law, MiniMe and its operators will not be liable for any indirect,
        incidental, special, consequential, or punitive damages, or for lost profits, revenue, data, or goodwill,
        arising from your use of the service. Our total liability for any claim relating to the service will not
        exceed the amount you paid us in the three months before the event giving rise to the claim.</P>
      </Section>

      <Section n={12} title="Governing law">
        <P>These Terms are governed by the laws of the Federal Democratic Republic of Ethiopia, without regard to
        conflict-of-laws rules. Disputes will be subject to the competent courts of Ethiopia, unless otherwise
        required by applicable law.</P>
      </Section>

      <Section n={13} title="Changes to these Terms">
        <P>We may update these Terms from time to time. Material changes will be reflected by updating the
        &ldquo;Last updated&rdquo; date above. Continued use after changes take effect means you accept the updated
        Terms.</P>
      </Section>

      <Section n={14} title="Contact">
        <P>Questions about these Terms? Email <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>.</P>
      </Section>

      <Callout>
        This document is a general template tailored to how MiniMe works and is not legal advice. Please have it
        reviewed by a qualified lawyer before relying on it.
      </Callout>
    </article>
  );
}
