const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';
const TENANT_ID = 't_demo_agency';

export class ApiError extends Error {
  readonly resolution: string;
  readonly status: number | null;

  constructor(message: string, resolution: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.resolution = resolution;
    this.status = status;
  }
}

/** 未ログイン (HTTP 401)。認証ゲートはこれを検知して /login へ誘導する */
export class ApiAuthError extends ApiError {
  constructor(
    message = 'ログインが必要です。',
    resolution = 'ログイン画面からもう一度ログインしてください。',
  ) {
    super(message, resolution, 401);
    this.name = 'ApiAuthError';
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError(
    '予期しないエラーが発生しました。',
    'ページを再読み込みして再試行してください。',
  );
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      // セッションは httpOnly クッキー。x-tenant-id はクッキーが無い開発環境向けフォールバック
      credentials: 'include',
      headers: { 'x-tenant-id': TENANT_ID, ...(init.headers ?? {}) },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      'APIサーバに接続できません。',
      `APIサーバ (${API_BASE}) が起動しているか確認し、再試行してください。`,
    );
  }
  if (!res.ok) {
    let message: string | undefined;
    let resolution: string | undefined;
    try {
      const body = (await res.json()) as { message?: unknown; resolution?: unknown };
      if (typeof body.message === 'string' && body.message) message = body.message;
      if (typeof body.resolution === 'string' && body.resolution) resolution = body.resolution;
    } catch {
      // JSONでないエラー応答はデフォルト文言のまま表示する
    }
    if (res.status === 401) throw new ApiAuthError(message, resolution);
    throw new ApiError(
      message ?? `リクエストに失敗しました (HTTP ${res.status})。`,
      resolution ?? '時間をおいて再試行してください。',
      res.status,
    );
  }
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** multipart/form-data 送信 (Content-Type はブラウザが boundary 付きで付与する) */
export function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return request<T>(path, { method: 'POST', body: form });
}
