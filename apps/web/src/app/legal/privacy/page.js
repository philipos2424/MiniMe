import { DocTitle, Lead, Section, P, UL, LI, Strong, A, Callout, SUPPORT_EMAIL } from '../_ui';

export const metadata = {
  title: 'Privacy Policy — MiniMe',
  description: 'How MiniMe collects, uses, and protects personal data.',
};

export default function PrivacyPolicy() {
  return (
    <article>
      <DocTitle>Privacy Policy</DocTitle>

      <Lead>
        MiniMe (&ldquo;MiniMe&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is an AI assistant that helps small
        business owners handle customer messages, orders, and payments across Telegram, WhatsApp, and Instagram.
        This policy explains what data we collect, how we use it, and the choices you have.
      </Lead>

      <Callout>
        This policy covers two kinds of people: <Strong>business owners</Strong> who sign up to use MiniMe, and the{' '}
        <Strong>customers and contacts</Strong> whose messages flow through a business&rsquo;s connected accounts.
        For those contacts, the business owner is the primary data controller and MiniMe acts as their service
        provider (processor).
      </Callout>

      <Section n={1} title="Information we collect">
        <P><Strong>Account &amp; business information.</Strong> When an owner signs up we collect their name,
        Telegram account ID, phone number, email, business name, category, location, business hours, languages,
        social handles, logo, and the configuration they provide (FAQs, rules, price list, tone/voice samples).</P>

        <P><Strong>Conversation content.</Strong> To draft replies, MiniMe processes the messages exchanged through
        a business&rsquo;s connected channels — text, voice notes, photos, and documents — together with sender
        names and IDs. In secretary mode (a connected personal Telegram Business account), this can include
        messages from anyone who texts that account, including non-customers.</P>

        <P><Strong>Contact profiles.</Strong> To reply naturally, the assistant may derive a short profile of a
        contact from the chat history — e.g. their name, how the owner usually addresses them, an inferred
        relationship (customer, family, friend), and brief context notes.</P>

        <P><Strong>Orders &amp; payments.</Strong> When an order is placed we process items, quantities, prices,
        delivery address, and phone number. Payments are handled by our payment processor (Chapa); we do not
        store full card or bank credentials.</P>

        <P><Strong>Technical data.</Strong> We log webhook events, timestamps, and IP addresses (used for rate
        limiting and abuse prevention), and basic usage metrics.</P>
      </Section>

      <Section n={2} title="How we use information">
        <UL>
          <LI>Generate and send replies in the owner&rsquo;s voice across their connected channels.</LI>
          <LI>Transcribe voice notes and describe images/documents so the assistant can respond to them.</LI>
          <LI>Create and track orders and generate payment links.</LI>
          <LI>Notify the owner about messages that need their attention (e.g. personal contacts, possible scams, failed actions).</LI>
          <LI>Maintain, secure, debug, and improve the service.</LI>
          <LI>Send service-related communications about the owner&rsquo;s account.</LI>
        </UL>
        <P>We do <Strong>not</Strong> sell personal data, and we do not use the content of customer conversations
        to train third-party foundation models.</P>
      </Section>

      <Section n={3} title="AI processing and sub-processors">
        <P>MiniMe relies on trusted third-party providers to operate. Conversation content and related data may be
        processed by these sub-processors, some of which operate outside Ethiopia:</P>
        <UL>
          <LI><Strong>OpenAI</Strong> — generating replies, transcribing voice (Whisper), and understanding images.</LI>
          <LI><Strong>Hasab</Strong> — Amharic speech-to-text transcription and translation.</LI>
          <LI><Strong>Supabase</Strong> — database and file storage for accounts, messages, and uploads.</LI>
          <LI><Strong>Vercel</Strong> — application hosting and serverless processing.</LI>
          <LI><Strong>Telegram, WhatsApp, and Instagram (Meta)</Strong> — the messaging platforms the assistant connects to.</LI>
          <LI><Strong>Chapa</Strong> — payment processing for orders and subscriptions.</LI>
        </UL>
        <P>Each provider processes data under its own terms and privacy policy. We share only what is needed for
        the service to function.</P>
      </Section>

      <Section n={4} title="Secretary mode and personal contacts">
        <P>When an owner connects a personal Telegram Business account, MiniMe can read and reply to messages on
        their behalf. The assistant is designed to recognise personal contacts (such as family and friends) and
        treat those chats as personal — it will not pitch the business or share catalog/pricing information in
        them. Owners can mark a contact as personal at any time, after which MiniMe stays out of that chat.</P>
      </Section>

      <Section n={5} title="Data retention">
        <P>We keep account and conversation data for as long as the owner&rsquo;s account is active, so the
        assistant can maintain context and history. When an account is deleted, we remove associated personal data
        within 30 days, except where we must retain limited records to meet legal, accounting, or fraud-prevention
        obligations. See <A href="/legal/data-deletion">Data Deletion</A> for how to request removal.</P>
      </Section>

      <Section n={6} title="Sharing and disclosure">
        <P>We share personal data only: with the sub-processors listed above; with the business owner whose account
        the data belongs to; when required by law or valid legal process; to protect the rights, safety, or
        property of users or the public; or in connection with a business transfer (e.g. merger), subject to this
        policy.</P>
      </Section>

      <Section n={7} title="Security">
        <P>We use encryption in transit, secret-token verification on webhooks, encrypted storage of sensitive
        credentials (such as bot tokens), rate limiting, and access controls. No system is perfectly secure, but we
        work to protect data using reasonable, industry-standard measures.</P>
      </Section>

      <Section n={8} title="Your rights and choices">
        <P>Depending on your location, you may have the right to access, correct, export, or delete your personal
        data, and to object to or restrict certain processing.</P>
        <UL>
          <LI><Strong>Business owners</Strong> can update most data in the app, or contact us to access or delete their account.</LI>
          <LI><Strong>Customers of a business</Strong> should contact that business directly (they control your data), or contact us and we will route the request to the relevant owner.</LI>
        </UL>
        <P>To exercise any right, email <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>.</P>
      </Section>

      <Section n={9} title="Children">
        <P>MiniMe is intended for business owners aged 18 or older and is not directed to children. We do not
        knowingly collect personal data from children.</P>
      </Section>

      <Section n={10} title="International transfers">
        <P>Because we use the providers listed above, your data may be processed in countries outside your own.
        Where required, we rely on appropriate safeguards for such transfers.</P>
      </Section>

      <Section n={11} title="Changes to this policy">
        <P>We may update this policy from time to time. Material changes will be reflected by updating the
        &ldquo;Last updated&rdquo; date above, and where appropriate we will notify owners in the app.</P>
      </Section>

      <Section n={12} title="Contact us">
        <P>Questions or requests? Email <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>.</P>
      </Section>

      <Callout>
        This document is provided as a general template tailored to how MiniMe works. It is not legal advice. Please
        have it reviewed by a qualified lawyer before relying on it, especially for compliance with the laws of
        Ethiopia and any other regions where you operate.
      </Callout>
    </article>
  );
}
