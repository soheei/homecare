import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || body?.success === false) {
    throw new Error(body?.error || `Request failed: ${res.status}`);
  }

  return body.data;
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
    delete: (id) => request(`/api/events/${id}`, { method: 'DELETE' })
  },
  devices: {
    list: () => request('/api/devices'),
    register: (device) =>
      request('/api/devices/register', {
        method: 'POST',
        body: JSON.stringify(device)
      }),
    getStatus: (id) => request(`/api/devices/${id}/status`),
    requestCapture: (id) =>
      request(`/api/devices/${id}/capture`, { method: 'POST' }),
    delete: (id) => request(`/api/devices/${id}`, { method: 'DELETE' })
  }
};
