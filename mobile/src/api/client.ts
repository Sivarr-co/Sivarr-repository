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
  weeklyReview:   (ctx: object) => post('/api/ai/weekly-review', ctx),
  parseIntent:    (text: string) => post('/api/ai/parse-intent', { text }),
  voiceToTask:    (transcript: string) => post('/api/ai/voice-to-task', { transcript }),

  // Org (v1: read/CRUD only — no chat/presence on mobile yet, see
  // routes/org.py; the web client's real-time layer has no mobile
  // equivalent, that's a separate, larger piece of work)
  orgGet:          () => post('/api/org/get', {}),
  orgCreate:       (name: string) => post('/api/org/create', { name }),
  orgJoin:         (inviteToken: string) => post('/api/org/join', { invite_token: inviteToken }),
  orgInvite:       (email: string, role = 'member') => post('/api/org/invite', { email, role }),
  orgTaskCreate:   (data: { title: string; description?: string; priority?: string; due_date?: string }) =>
    post('/api/org/tasks/create', data),
  orgTaskUpdate:   (taskId: string, updates: object) => post('/api/org/tasks/update', { task_id: taskId, ...updates }),
  orgTaskDelete:   (taskId: string) => post('/api/org/tasks/delete', { task_id: taskId }),
  orgGoalCreate:   (data: { title: string; description?: string; due_date?: string }) =>
    post('/api/org/goals/create', data),
  orgDocsList:     () => post('/api/org/docs', {}),
  orgDocGet:       (docId: string) => post('/api/org/docs/get', { doc_id: docId }),
  orgDocSave:      (docId: string | null, title: string, content: string) =>
    post('/api/org/docs/save', { doc_id: docId ?? '', title, content }),

  // Notifications (server-driven — see app.py's send_push()/_send_expo_push())
  pushExpoSubscribe:      (expoToken: string) => post('/api/push/expo/subscribe', { expo_token: expoToken }),
  notifications:          () => get('/api/notifications/list'),
  notificationMarkRead:   (id: string) => post('/api/notifications/mark-read', { id }),
  notificationMarkAllRead: () => post('/api/notifications/mark-all-read', {}),
};
