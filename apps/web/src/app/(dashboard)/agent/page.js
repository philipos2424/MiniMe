'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '../../../hooks/useSupabase';
import TaskCard from '../../../components/agent/TaskCard';
import Link from 'next/link';

export default function AgentPage() {
  const supabase = useSupabase();
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    async function load() {
      const { data: biz } = await supabase.from('businesses').select('id').limit(1).single();
      if (!biz) return;
      let q = supabase.from('agent_tasks').select('*').eq('business_id', biz.id).order('created_at', { ascending: false }).limit(50);
      if (filter !== 'all') q = q.eq('status', filter);
      const { data } = await q;
      setTasks(data || []);
    }
    load();
  }, [filter]);

  const counts = {
    active: tasks.filter(t => t.status === 'in_progress').length,
    awaiting: tasks.filter(t => t.status === 'awaiting_approval').length,
    done: tasks.filter(t => t.status === 'completed').length,
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl text-gold-light">Agent Tasks</h1>
      <div className="grid grid-cols-3 gap-4">
        {[['Active', counts.active, '#D97706'], ['Awaiting', counts.awaiting, '#7C3AED'], ['Done', counts.done, '#059669']].map(([label, count, color]) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold" style={{ color }}>{count}</div>
            <div className="text-muted text-sm">{label}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {['all', 'awaiting_approval', 'in_progress', 'completed'].map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-sm capitalize transition ${filter === s ? 'bg-gold text-bg' : 'bg-card border border-border text-muted'}`}>
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {tasks.map(t => (
          <Link key={t.id} href={`/agent/${t.id}`}><TaskCard task={t} /></Link>
        ))}
        {!tasks.length && <p className="text-muted text-center py-8">No tasks yet</p>}
      </div>
    </div>
  );
}
