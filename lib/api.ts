'use client';

export const SHARED_PASSWORD =
  process.env.NEXT_PUBLIC_SHARED_PASSWORD?.trim() ?? '';

export const CONVERSATION_SOFT_CAP_USER_MESSAGES = 5;
export const CONVERSATION_HARD_CAP_USER_MESSAGES = 8;
export const DEFAULT_SURVEY_HANDOFF_URL =
  'https://mit.co1.qualtrics.com/jfe/form/SV_9XgScygpYy5gIjY';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? '';

const LOCAL_API_BASE_URL =
  process.env.NEXT_PUBLIC_LOCAL_API_BASE_URL?.replace(/\/$/, '') ??
  'http://localhost:5328/api';

const combineUrl = (base: string, path: string) =>
  `${base.replace(/\/$/, '')}/${path.replace(/^\/+/, '')}`;

export const resolveApiUrl = (path: string) => {
  if (API_BASE_URL) {
    return combineUrl(API_BASE_URL, path);
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const origin = window.location.origin.replace(/\/$/, '');
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return combineUrl(LOCAL_API_BASE_URL, path);
    }
    return combineUrl(`${origin}/api`, path);
  }

  return combineUrl('/api', path);
};
