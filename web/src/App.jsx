import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import ChatScreen from './screens/ChatScreen';
import EventsScreen from './screens/EventsScreen';
import SettingsScreen from './screens/SettingsScreen';
import BottomNav from './components/BottomNav';
import { C } from './theme';

function AppShell() {
  const { session, loading } = useAuth();
  const [tab, setTab] = useState(0);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: C.textLight }}>
        불러오는 중...
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  const screens = [HomeScreen, ChatScreen, EventsScreen, SettingsScreen];
  const ActiveScreen = screens[tab];

  return (
    <div style={{ maxWidth: 430, margin: '0 auto', minHeight: '100vh', background: C.bg, position: 'relative', fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ paddingBottom: 80 }}>
        <ActiveScreen />
      </div>
      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
