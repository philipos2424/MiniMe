'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '../../../../hooks/useSupabase';
import CustomerProfile from '../../../../components/customers/CustomerProfile';
import { COLORS, FONT } from '../../../../lib/design-tokens';

export default function CustomerDetailPage({ params }) {
  const supabase = useSupabase();
  const [customer, setCustomer] = useState(null);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    async function load() {
      const { data: c } = await supabase.from('customers').select('*').eq('id', params.id).single();
      setCustomer(c);
      const { data: m } = await supabase.from('messages').select('*').eq('customer_id', params.id).order('created_at', { ascending: false }).limit(20);
      setMessages(m || []);
    }
    load();
  }, [params.id]);

  if (!customer) return <div style={{ padding: 16, fontSize: 14, color: COLORS.textHint, fontFamily: FONT.body }}>Loading...</div>;
  return <CustomerProfile customer={customer} messages={messages} />;
}
