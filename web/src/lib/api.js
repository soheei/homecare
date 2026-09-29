import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
      ...options.headers
    }
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || body?.success === false) {
    const err = new Error(body?.error || `Request failed: ${res.status}`);
    err.status = res.status; // 호출하는 쪽이 상태별로 처리할 수 있게 (예: 409 카메라 꺼짐)
    throw err;
  }

  return body.data;
}

/** 인증이 필요한 이미지(카메라 캡처 등) — <img src>는 토큰을 못 보내서 fetch 후 Blob으로 */
async function requestBlob(path) {
  const res = await fetch(`${API_URL}${path}`, { headers: await authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = new Error(body?.error || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.blob();
}

export const api = {
  chat: {
    sendMessage: (message, conversationId) =>
      request('/api/chat/message', {
        method: 'POST',
        body: JSON.stringify({ message, conversationId })
      }),
    getHistory: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request(`/api/chat/history${qs ? `?${qs}` : ''}`);
    },
    getDailySummary: (date) =>
      request('/api/chat/summary', {
        method: 'POST',
        body: JSON.stringify({ date })
      }),
    getLatestSummary: () => request('/api/chat/summary/latest'),
    deleteConversation: (conversationId) =>
      request(`/api/chat/history/${conversationId}`, { method: 'DELETE' })
  },
  events: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request(`/api/events${qs ? `?${qs}` : ''}`);
    },
    getById: (id) => request(`/api/events/${id}`),
    getDailySummary: (date) =>
      request(`/api/events/summary/daily${date ? `?date=${date}` : ''}`),
    getWeeklySummary: () => request('/api/events/summary/weekly'),
    delete: (id) => request(`/api/events/${id}`, { method: 'DELETE' }),
    // ids를 주면 선택한 이벤트만, 생략하면 전체
    deleteMany: (ids) => request('/api/events', {
      method: 'DELETE',
      ...(ids ? { body: JSON.stringify({ ids }) } : {})
    })
  },
  devices: {
    list: () => request('/api/devices'),
    register: (device) =>
      request('/api/devices/register', {
        method: 'POST',
        body: JSON.stringify(device)
      }),
    getStatus: (id) => request(`/api/devices/${id}/status`),
    // 라즈베리파이 카메라로 실제 촬영 → { captureId, imageUrl, capturedAt, ... } (촬영이 끝날 때까지 기다림)
    requestCapture: (id) =>
      request(`/api/devices/${id}/capture`, { method: 'POST' }),
    // imageUrl(/api/devices/:id/captures/:captureId) → Blob
    getCaptureImage: (imageUrl) => requestBlob(imageUrl),
    delete: (id) => request(`/api/devices/${id}`, { method: 'DELETE' })
  },
  notifications: {
    getPublicKey: () => request('/api/notifications/public-key'),
    getPreferences: () => request('/api/notifications/preferences'),
    updatePreferences: (prefs) =>
      request('/api/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify(prefs)
      }),
    subscribe: (subscription) =>
      request('/api/notifications/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription })
      }),
    unsubscribe: (endpoint) =>
      request('/api/notifications/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint })
      })
  }
};
