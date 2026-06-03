import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const BASE = Constants.expoConfig?.extra?.apiUrl ?? 'https://sivarr-repository-production.up.railway.app';

async function getToken(): Promise<string> {
  return (await SecureStore.getItemAsync('sivarr_token')) ?? '';
}

async function post(path: string, body: object): Promise<any> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function get(path: string, params: Record<string, string> = {}): Promise<any> {
  const token = await getToken();
  const qs = new URLSearchParams({ ...params, token }).toString();
  const res = await fetch(`${BASE}${path}?${qs}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Auth
  login:    (email: string, password: string) => post('/api/login', { email, password }),
  register: (name: string, email: string, password: string) => post('/api/register', { name, email, password }),
  me:       () => get('/api/me'),

  // Billing
  billingStatus:  () => get('/api/billing/status'),
  billingHistory: () => get('/api/billing/history'),

  // Community
  communityPosts:  (category = 'all') => get('/api/community/posts', { category }),
  communityPost:   (body: string, category: string) => post('/api/community/posts', { body, category }),
  communityLike:   (postId: string) => post(`/api/community/posts/${postId}/like`, {}),
  communityReply:  (postId: string, body: string) => post(`/api/community/posts/${postId}/reply`, { body }),

  // Opportunities
  opportunities: (category = 'all') => get('/api/opportunities', { category }),
  submitOpp:     (data: object) => post('/api/opportunities', data),

  // Goals (token is injected automatically by post/get)
  goals:      () => get('/api/goals'),
  addGoal:    (data: { title: string; subject?: string; deadline?: string }) =>
    post('/api/goals/add', { title: data.title, subject: data.subject ?? '', deadline: data.deadline ?? '', target_score: 70 }),
  updateGoal: (id: string, progress: number, completed: boolean) =>
    post('/api/goals/update', { id, progress, completed }),
  deleteGoal: (id: string) => post('/api/goals/delete', { id }),

  // AI
  aiChat:         (message: string, session = 'main') => post('/api/chat', { message, session }),
  aiExtractTasks: (text: string) => post('/api/ai/extract-tasks', { text }),
  aiWrite:        (text: string, action: string) => post('/api/ai/write', { text, action }),
  homeBrief:      (ctx: object) => post('/api/home/brief', ctx),
};
