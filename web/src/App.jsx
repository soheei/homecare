import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import ChatScreen from './screens/ChatScreen';
import EventsScreen from './screens/EventsScreen';
import SettingsScreen from './screens/SettingsScreen';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import BottomNav from './components/BottomNav';

function AppShell() {
  const { session, loading } = useAuth();
  const [tab, setTab] = useState(0);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-light">
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
    <div className="relative mx-auto min-h-screen max-w-[430px] bg-[#f7f8fa] font-sans">
      <div className="pb-20">
        <ActiveScreen />
      </div>
      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordScreen />} />
          <Route path="*" element={<AppShell />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
