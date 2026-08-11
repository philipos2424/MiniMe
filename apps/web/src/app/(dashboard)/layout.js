import { TelegramProvider } from '../../context/TelegramContext';
import DashboardShell from '../../components/layout/DashboardShell';
import Tracker from '../../components/Tracker';

export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }) {
  return (
    <TelegramProvider>
      {/* Inside the provider (so it can read identity) but OUTSIDE DashboardShell
          on purpose: the Shell early-returns for the loading splash, the "open in
          Telegram" error and the bare onboarding flow, so a tracker mounted
          inside it would go blind on exactly the onboarding funnel we most need
          to see. */}
      <Tracker surface="dashboard" />
      <DashboardShell>{children}</DashboardShell>
    </TelegramProvider>
  );
}
