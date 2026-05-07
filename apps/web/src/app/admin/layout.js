import { TelegramProvider } from '../../context/TelegramContext';

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }) {
  return (
    <TelegramProvider>
      {children}
    </TelegramProvider>
  );
}
