import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../lib/server/supabase-client';
import { whatchimp } from '../../lib/server/whatchimp.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const businessId = searchParams.get('businessId');

    if (!customerId || !businessId) {
      return NextResponse.json({ error: 'Missing customerId or businessId' }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const whatsappPhone = customer.whatsapp_phone || '';
    
    const whatchimpResponse = await whatchimp.generateConnectUrl({
      phoneNumber: whatsappPhone,
      businessId: businessId,
    });

    return NextResponse.json({ url: whatchimpResponse.url });
  } catch (error) {
    console.error('[WhatsApp Connect API Error]:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
