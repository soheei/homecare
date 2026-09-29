import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppDataProvider } from './context/AppDataContext';
import { ChatProvider } from './context/ChatContext';
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
  // 채팅 화면이 알려주는 모바일 키보드 열림 여부 → 하단바를 숨김
  const [keyboardOpen, setKeyboardOpen] = useState(false);

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

  // 화면은 탭마다 unmount되지만, 데이터/채팅 상태는 이 Provider들(로그인 세션 동안 유지)에 있음.
  // key를 사용자 id로 둬서 다른 계정으로 로그인하면 캐시/채팅이 섞이지 않고 새로 시작됨.
  const userId = session.user.id;

  return (
    <AppDataProvider key={`data-${userId}`}>
      <ChatProvider key={`chat-${userId}`} userId={userId}>
        <div className="relative mx-auto min-h-screen max-w-[430px] bg-[#f7f8fa] font-sans">
          <div className="pb-24">
            <ActiveScreen onKeyboardChange={setKeyboardOpen} />
          </div>
          <BottomNav tab={tab} setTab={setTab} hidden={keyboardOpen} />
        </div>
      </ChatProvider>
    </AppDataProvider>
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
