'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '../../../../hooks/useSupabase';

export default function VoicePage() {
  const supabase = useSupabase();
  const [business, setBusiness] = useState(null);
  const [samples, setSamples] = useState([]);
  const [newSample, setNewSample] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('businesses').select('id,name,voice_embedding,sample_replies').limit(1).single();
      setBusiness(data);
      setSamples(data?.sample_replies || []);
    }
    load();
  }, []);

  async function addSample() {
    if (!newSample.trim() || !business) return;
    const updated = [...samples, newSample.trim()];
    setSamples(updated);
    setNewSample('');
    await supabase.from('businesses').update({ sample_replies: updated }).eq('id', business.id);
  }

  async function removeSample(i) {
    const updated = samples.filter((_, idx) => idx !== i);
    setSamples(updated);
    await supabase.from('businesses').update({ sample_replies: updated }).eq('id', business.id);
  }

  const profile = business?.voice_embedding || {};

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="font-display text-2xl text-gold-light">Voice & Style</h1>

      {Object.keys(profile).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          <h2 className="text-gold font-semibold text-sm">Your Voice Profile</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-muted">Language:</span> <span className="text-body">{profile.language?.primary}</span></div>
            <div><span className="text-muted">Tone:</span> <span className="text-body">Formality {profile.tone?.formality}/5</span></div>
            <div><span className="text-muted">Greeting:</span> <span className="text-body">{profile.greeting?.opener}</span></div>
            <div><span className="text-muted">Emojis:</span> <span className="text-body">{profile.tone?.emojiUsage}</span></div>
          </div>
          {profile.uniquePhrases?.length > 0 && (
            <div><span className="text-muted text-xs">Signature phrases: </span>{profile.uniquePhrases.map(p => <span key={p} className="text-xs bg-bg border border-border rounded px-1.5 py-0.5 mr-1">{p}</span>)}</div>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h2 className="text-gold font-semibold text-sm">Training Samples ({samples.length})</h2>
        <p className="text-muted text-xs">Add examples of how you reply to customers. The more you add, the better MiniMe sounds like you.</p>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {samples.map((s, i) => (
            <div key={i} className="flex items-start gap-2 bg-bg rounded-lg p-2">
              <p className="flex-1 text-sm text-body">{s}</p>
              <button onClick={() => removeSample(i)} className="text-muted hover:text-red-400 text-xs shrink-0">✕</button>
            </div>
          ))}
          {!samples.length && <p className="text-muted text-sm text-center py-4">No samples yet</p>}
        </div>
        <div className="flex gap-2">
          <textarea value={newSample} onChange={e => setNewSample(e.target.value)} placeholder='e.g. "ሰላም! እንኳን ደህና መጡ! How can I help you today? 😊"' className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-body placeholder-muted text-sm resize-none focus:outline-none focus:border-gold" rows={2} />
          <button onClick={addSample} disabled={!newSample.trim()} className="bg-gold text-bg font-semibold px-3 rounded-lg hover:bg-gold-light transition disabled:opacity-50 self-end py-2">Add</button>
        </div>
      </div>
    </div>
  );
}
