export const CATEGORIES = ['BREAKFAST', 'MAIN', 'SOUP', 'BREAD', 'DESSERT', 'DRINK'] as const;
export const KITCHENS = ['MASRI', 'SHAMI', 'KHALEEJI', 'MAGHRIBI'] as const;
export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;

export const CATEGORY_NAMES: Record<string, string> = {
  BREAKFAST: 'فطار ومقبلات', MAIN: 'أطباق رئيسية', SOUP: 'شوربة وطواجن',
  BREAD: 'خبز ومعجنات', DESSERT: 'حلويات', DRINK: 'مشروبات',
};
export const KITCHEN_NAMES: Record<string, string> = {
  MASRI: 'مصري', SHAMI: 'شامي', KHALEEJI: 'خليجي', MAGHRIBI: 'مغربي',
};
export const DIFFICULTY_NAMES: Record<string, string> = {
  EASY: 'سهل', MEDIUM: 'متوسط', HARD: 'محتاج صبر',
};

export type Ingredient = { name: string; amount: string };
export type Step = { text: string; minutes: number; tip?: string | null };
export type Recipe = {
  id: string; name: string; subtitle: string; category: string; kitchen: string;
  emoji: string; imageUrl?: string; signedImageUrl?: string;
  prepMinutes: number; cookMinutes: number; servings: number;
  difficulty: string; description: string; ingredients: Ingredient[]; steps: Step[]; notes: string[];
};
export type ChefPost = { id: string; title: string; assetPath: string; imageUrl: string; sourceUrl: string; signedUrl?: string };
export type ChefPosts = { nadia: ChefPost[]; magda: ChefPost[] };
export type Meta = { featured: string[] };
export type Content = { recipes: Recipe[]; chefPosts: ChefPosts; meta: Meta };

export type DocKey = 'recipes' | 'chef_posts' | 'meta';

export class ApiError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

const TOKEN_KEY = 'matbakhi.admin.token';
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (value: string) => localStorage.setItem(TOKEN_KEY, value),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// Empty (local dev via Vite proxy, or same-origin deploy) → relative
// /functions/v1/app path; hosted GitHub Pages builds set VITE_API_BASE to the
// Supabase Edge Function URL.
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = tokenStore.get();
  if (token && path !== '/api/login') headers.set('authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/functions/v1/app${path}`, { credentials: 'same-origin', ...init, headers, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ApiError('network_error', 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(typeof body?.error === 'string' ? body.error : 'request_failed', response.status);
  return body as T;
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'بيانات الدخول غير صحيحة.',
  login_required: 'انتهت الجلسة، سجّل الدخول من جديد.',
  invalid_input: 'بيانات غير صالحة — راجعي الحقول المطلوبة.',
  invalid_upload: 'الصورة يجب أن تكون PNG أو JPEG أو WebP وبحجم أقل من 5 ميغابايت.',
  payload_too_large: 'المحتوى كبير جدًا للحفظ.',
  network_error: 'تعذّر الاتصال بالخادم.',
  request_failed: 'حدث خطأ غير متوقع.',
  storage_unavailable: 'خدمة الصور غير متاحة الآن.',
  database_not_configured: 'قاعدة البيانات غير مهيأة بعد.',
  database_credential_rejected: 'تعذّر الوصول لقاعدة البيانات — راجعي إدارة المنصة.',
};
export const message = (error: unknown) =>
  MESSAGES[error instanceof ApiError ? error.code : ''] ?? 'تعذّر إتمام العملية، حاولي مرة أخرى.';

export function stripSignatures(chefPosts: ChefPosts): ChefPosts {
  const clean = (posts: ChefPost[]) => posts.map(({ signedUrl: _s, ...post }) => post);
  return { nadia: clean(chefPosts.nadia), magda: clean(chefPosts.magda) };
}

export function stripRecipeSignatures(recipes: Recipe[]): Recipe[] {
  return recipes.map(({ signedImageUrl: _signed, ...recipe }) => recipe);
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** تسهيل البحث العربي مثل منطق التطبيق: توحيد الألف والتاء المربوطة وحذف التشكيل */
export function normalizeArabic(input: string) {
  return input
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .toLowerCase();
}
