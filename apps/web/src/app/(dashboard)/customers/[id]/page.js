'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import CustomerProfile from '../../../../components/customers/CustomerProfile';
import { COLORS, FONT } from '../../../../lib/design-tokens';

export default function CustomerDetailPage({ params }) {
  const { business: ctxBusiness } = useTelegram();
  const [customer, setCustomer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!ctxBusiness?.id) return;
    const supabase = createClient();
    async function load() {
      // Always scope to the authenticated owner's business_id
      const { data: c } = await supabase
        .from('customers')
        .select('*')
        .eq('id', params.id)
        .eq('business_id', ctxBusiness.id)
        .single();
      if (!c) { setNotFound(true); return; }
      setCustomer(c);
      const { data: m } = await supabase
        .from('messages')
        .select('*')
        .eq('customer_id', params.id)
        .eq('business_id', ctxBusiness.id)
        .order('created_at', { ascending: false })
        .limit(20);
      setMessages(m || []);
    }
    load();
  }, [params.id, ctxBusiness?.id]);

  if (notFound) return <div style={{ padding: 16, fontSize: 14, color: COLORS.textHint, fontFamily: FONT.body }}>Customer not found.</div>;
  if (!customer) return <div style={{ padding: 16, fontSize: 14, color: COLORS.textHint, fontFamily: FONT.body }}>Loading...</div>;
  return <CustomerProfile customer={customer} messages={messages} />;
}
