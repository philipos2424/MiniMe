
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(req) {
  try {
    const { token, message } = await req.json();
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { cookies: { get: (name) => cookieStore.get(name)?.value } }
    );

    // 1. Verify Token and get Business
    const { data: business, error: bError } = await supabase
      .from('businesses')
      .select('*')
      .eq('onboarding_token', token)
      .single();

    if (bError || !business) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    // 2. Trigger Persona Engine / Scribe
    // NOTE: In this prototype, we are simulating the AI response here
    // but in the next phase, this will call the actual shared AI service.
    
    let responseText = "";
    let updatedScribe = business.scribe_state || { captured: [], missing: [] };

    if (!business.name || business.name === 'My Business') {
       responseText = `That's a great start. But tell me more—what do you call your brand, and what's the core "soul" of what you do?`;
       updatedScribe.captured.push('business_name');
    } else {
       responseText = `I love the vibe of ${business.name}. Now, if I were to buy from you, what's the one "hero product" I absolutely cannot miss, and what's the price?`;
    }

    // 3. Update Scribe State in DB
    await supabase
      .from('businesses')
      .update({ scribe_state: updatedScribe })
      .eq('id', business.id);

    return NextResponse.json({ 
      message: responseText, 
      scribeState: updatedScribe 
    });

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
