import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export default function OnboardingStudio() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const supabase = createClientComponentClient();
  
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [scribeState, setScribeState] = useState({ captured: [], missing: [] });
  const [input, setInput] = useState('');

  useEffect(() => {
    async function init() {
      if (!token) {
        setError("No onboarding token provided.");
        setLoading(false);
        return;
      }

      const { data, error: dbError } = await supabase
        .from('businesses')
        .select('*')
        .eq('onboarding_token', token)
        .single();

      if (dbError || !data) {
        setError("Invalid or expired session token.");
      } else {
        setBusiness(data);
        setScribeState(data.scribe_state || { captured: [], missing: [] });
        // Initialize first message from AI
        setMessages([{ role: 'assistant', content: "Hello! I just found your business and I'm very curious. Who are you and what do you specialize in?" }]);
      }
      setLoading(false);
    }
    init();
  }, [token, supabase]);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    const currentInput = input;
    setInput('');

    try {
      const res = await fetch('/api/onboarding/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, message: currentInput }),
      });
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
      setScribeState(data.scribeState);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm having a moment of silence... check your connection and try again." }]);
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-black text-white font-mono uppercase tracking-widest">CRAFTING STUDIO...</div>;
  if (error) return <div className="flex h-screen items-center justify-center bg-black text-red-500 font-mono">{error}</div>;

  return (
    <div className="flex h-screen bg-black text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar: The Scribe */}
      <div className="w-80 bg-zinc-900 border-r border-zinc-800 p-6 flex flex-col gap-6 hidden md:flex">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-white rounded-full" /> 
          <span className="font-bold text-xl tracking-tight">MiniMe Studio</span>
        </div>
        
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Scribe Analysis</h3>
          <div className="space-y-2">
            <ScribeItem label="Business Name" status={scribeState.captured.includes('business_name') ? 'captured' : 'missing'} />
            <ScribeItem label="Category" status={scribeState.captured.includes('category') ? 'captured' : 'missing'} />
            <ScribeItem label="Price List" status={scribeState.captured.includes('price_list') ? 'captured' : 'missing'} />
            <ScribeItem label="Voice Soul" status={scribeState.captured.includes('voice_profile') ? 'captured' : 'missing'} />
          </div>
        </div>
      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col relative">
        <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-center pointer-events-none">
          <div className="bg-zinc-800/50 backdrop-blur-md px-4 py-2 rounded-full text-xs font-medium text-zinc-400 border border-zinc-700 pointer-events-auto">
            Simulation: <span className="text-white">High-Value Prospect</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 pt-24 space-y-6 max-w-3xl mx-auto w-full">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-md p-4 rounded-2xl ${m.role === 'user' ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-100'} transition-all shadow-xl`}>
                <p className="text-sm leading-relaxed">{m.content}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="p-6 border-t border-zinc-800 bg-black/50 backdrop-blur-xl">
          <div className="max-w-3xl mx-auto relative flex items-center gap-3">
            <button className="p-3 rounded-full bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-all">
              <span className="text-lg">+</span>
            </button>
            <input 
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-6 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
              placeholder="Speak to your customer..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />
            <button 
              onClick={handleSend}
              className="bg-white text-black px-6 py-3 rounded-full text-sm font-bold hover:bg-zinc-200 transition-all"
            >
              Send
            </button>
          </div>
          <div className="mt-4 text-center">
            <p className="text-[10px] text-zinc-500 uppercase tracking-tighter">MiniMe Persona Engine v1.0 — Hyper-Realistic Mode</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScribeItem({ label, status }) {
  const colors = { captured: 'text-emerald-400', missing: 'text-zinc-600' };
  const icons = { captured: '✓', missing: '○' };
  return (
    <div className="flex justify-between items-center p la-2 rounded-lg bg-zinc-800/30 border border-transparent hover:border-zinc-700 transition-all">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className={`text-xs font-mono ${colors[status]}`}>{icons[status]}</span>
    </div>
  );
}
