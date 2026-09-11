import { NextResponse } from 'next/server';
import { createClient } from '../../lib/supabase-browser';
import { whatchimp } from '../../lib/server/whatchimp.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const businessId = searchParams.get('businessId');

    if (!customerId || !businessId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // In a real WhatChimp/Meta flow, we generate a specific onboarding URL
    // that contains the business context.
    const onboardingUrl = `${process.env.WHATCHIMP_API_URL}/onboarding?biz_id=${businessId}&customer_id=${customerId}`;

    return NextResponse.json({ url: onboardingUrl });
  } catch (error) {
    console.error('[WA-Connect] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { customerId, phone } = body;

    if (!customerId || !phone) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    const supabase = createClient();
    const { error } = await supabase
      .from('customers')
      .update({ whatsapp_phone: phone })
      .eq('id', customerId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}