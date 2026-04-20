import { TelegramProvider } from '../../context/TelegramContext';
import DashboardShell from '../../components/layout/DashboardShell';

export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }) {
  return (
    <TelegramProvider>
      <DashboardShell>{children}</DashboardShell>
    </TelegramProvider>
  );
}
