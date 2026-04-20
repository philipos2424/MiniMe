'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '../../../../hooks/useSupabase';
import TaskTimeline from '../../../../components/agent/TaskTimeline';
import DecisionLog from '../../../../components/agent/DecisionLog';

export default function TaskDetailPage({ params }) {
  const supabase = useSupabase();
  const [task, setTask] = useState(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('agent_tasks').select('*').eq('id', params.id).single();
      setTask(data);
    }
    load();
  }, [params.id]);

  if (!task) return <div className="text-muted">Loading...</div>;

  const statusColor = { completed: '#059669', in_progress: '#D97706', awaiting_approval: '#7C3AED', failed: '#ef4444', cancelled: '#6B7280', pending: '#6B7280' }[task.status] || '#6B7280';

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="font-display text-2xl text-gold-light">{task.title}</h1>
          <span className="px-2 py-0.5 rounded text-xs capitalize" style={{ background: statusColor + '33', color: statusColor }}>{task.status.replace('_', ' ')}</span>
        </div>
        {task.estimated_amount && <p className="text-gold font-semibold">{task.estimated_amount} ETB{task.supplier_name ? ` — ${task.supplier_name}` : ''}</p>}
        <p className="text-muted text-sm mt-1">{task.description}</p>
      </div>
      <TaskTimeline steps={task.steps || []} />
      <DecisionLog log={task.decision_log || []} />
    </div>
  );
}
