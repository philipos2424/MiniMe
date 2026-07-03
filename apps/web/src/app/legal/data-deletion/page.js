import { DocTitle, Lead, Section, P, UL, LI, Strong, A, Callout, SUPPORT_EMAIL } from '../_ui';

export const metadata = {
  title: 'Data Deletion — MiniMe',
  description: 'How to delete your MiniMe account and personal data.',
};

export default function DataDeletion() {
  return (
    <article>
      <DocTitle>Data Deletion Instructions</DocTitle>

      <Lead>
        You can ask us to delete your MiniMe account and the personal data associated with it. This page explains
        how, what gets removed, and how long it takes.
      </Lead>

      <Section n={1} title="If you are a business owner">
        <P>To delete your account and data, choose either option:</P>
        <UL>
          <LI><Strong>In the app:</Strong> open Settings and use the account-deletion option, if available to your plan.</LI>
          <LI><Strong>By email:</Strong> send a message to <A href={`mailto:${SUPPORT_EMAIL}?subject=Data%20Deletion%20Request`}>{SUPPORT_EMAIL}</A> from the email on your account, with the subject &ldquo;Data Deletion Request&rdquo;. Include your business name and Telegram username so we can verify you.</LI>
        </UL>
      </Section>

      <Section n={2} title="If you are a customer of a business using MiniMe">
        <P>You don&rsquo;t need to email anyone — you can do this yourself, instantly, in the same chat:</P>
        <UL>
          <LI><Strong>Message the bot &ldquo;delete my data&rdquo;</Strong> and it deletes your profile, message history, and anything MiniMe learned about you at that business immediately. (Want to see it first? Send &ldquo;/mydata&rdquo; for a JSON copy.)</LI>
          <LI>Prefer to go through the business instead, or the bot isn&rsquo;t responding? Contact the business directly, or email us at <A href={`mailto:${SUPPORT_EMAIL}?subject=Data%20Deletion%20Request`}>{SUPPORT_EMAIL}</A> and we will route your request to the relevant business owner and assist with removal.</LI>
        </UL>
        <P>Past orders are kept only as anonymous accounting records (no longer linked to you), as required by law.</P>
      </Section>

      <Section n={3} title="What gets deleted">
        <UL>
          <LI>Your account and business profile.</LI>
          <LI>Stored conversations, contact profiles, and uploaded files (such as documents and images).</LI>
          <LI>Connected-channel credentials and configuration we hold for you.</LI>
        </UL>
        <P>We may retain a limited amount of data where we are legally required to (for example, transaction or tax
        records held by our payment processor), and anonymised or aggregated data that can no longer identify you.</P>
      </Section>

      <Section n={4} title="Timeline">
        <P>We process verified deletion requests and remove the associated personal data within <Strong>30
        days</Strong>. We will confirm by email once the request is complete.</P>
      </Section>

      <Section n={5} title="Disconnecting a channel">
        <P>To stop MiniMe from processing new messages immediately, disconnect the bot from your Telegram Business
        settings, or remove the WhatsApp/Instagram connection in your channel settings. Disconnecting stops future
        processing; to also erase stored data, submit a deletion request above.</P>
      </Section>

      <Callout>
        Need help with a deletion request? Email <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A> and we will
        guide you through it.
      </Callout>
    </article>
  );
}
