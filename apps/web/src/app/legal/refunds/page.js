import { DocTitle, Lead, Section, P, UL, LI, Strong, A, Callout, SUPPORT_EMAIL } from '../_ui';

export const metadata = {
  title: 'Refund & Cancellation Policy — MiniMe',
  description: 'How subscription cancellations and refunds work on MiniMe.',
};

export default function RefundPolicy() {
  return (
    <article>
      <DocTitle>Refund &amp; Cancellation Policy</DocTitle>

      <Lead>
        This policy explains how cancellations and refunds work for MiniMe subscriptions, and clarifies how
        payments your customers make through MiniMe are handled.
      </Lead>

      <Section n={1} title="Free trial">
        <P>If we offer a free trial, you will not be charged during the trial period. Unless you cancel before the
        trial ends, your plan converts to a paid subscription and billing begins automatically. You can cancel any
        time during the trial from your billing settings.</P>
      </Section>

      <Section n={2} title="Subscription billing">
        <UL>
          <LI>Paid plans are billed in advance for each billing period (e.g. monthly), through our payment processor, Chapa.</LI>
          <LI>Your subscription renews automatically until you cancel.</LI>
          <LI>Prices are shown in the app and may change with notice; changes do not affect the period you have already paid for.</LI>
        </UL>
      </Section>

      <Section n={3} title="Cancelling your subscription">
        <P>You can cancel at any time from your billing settings or by emailing{' '}
        <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>. When you cancel, your plan stays active until the
        end of the current billing period, and it will not renew after that. We do not automatically pro-rate or
        refund the unused part of a period unless required by law.</P>
      </Section>

      <Section n={4} title="Subscription refunds">
        <P>Subscription fees are generally non-refundable, except:</P>
        <UL>
          <LI>Where a refund is required by applicable law.</LI>
          <LI>Where you were charged in error (e.g. a duplicate charge or a charge after a valid cancellation).</LI>
          <LI>At our discretion, for a documented, prolonged service failure that we could not resolve.</LI>
        </UL>
        <P>Approved refunds are returned to the original payment method via Chapa. Processing times depend on Chapa
        and your bank.</P>
      </Section>

      <Section n={5} title="Payments your customers make">
        <Callout>
          When your customer pays for an <Strong>order</Strong> through a MiniMe payment link, that payment is a
          transaction between <Strong>you and your customer</Strong>, processed by Chapa. MiniMe is not the seller
          and is not a party to that sale.
        </Callout>
        <P>Refunds, returns, cancellations, and disputes for those orders are handled by you, the business owner,
        according to your own policies and applicable consumer-protection law. MiniMe provides tools to help you
        process an order refund, but the decision and obligation are yours.</P>
      </Section>

      <Section n={6} title="How to request a refund">
        <P>Email <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A> with your account details and the reason
        for the request. We aim to respond within a reasonable time and will let you know whether your request
        qualifies under this policy.</P>
      </Section>

      <Callout>
        This document is a general template and is not legal advice. Please have it reviewed by a qualified lawyer
        and align it with the requirements of Chapa and applicable Ethiopian consumer-protection law.
      </Callout>
    </article>
  );
}
