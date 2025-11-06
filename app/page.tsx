'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { resolveApiUrl, PASSWORD_STORAGE_KEY } from '@/lib/api';

export default function WelcomePage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const stored = window.localStorage.getItem(PASSWORD_STORAGE_KEY);
    if (stored) {
      setPassword(stored);
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isStarting) {
      return;
    }

    const trimmedPassword = password.trim();
    if (!trimmedPassword) {
      setErrorMessage('Enter the survey access code to continue.');
      return;
    }

    setIsStarting(true);
    setErrorMessage(null);

    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(PASSWORD_STORAGE_KEY, trimmedPassword);
      }

      const response = await fetch(resolveApiUrl('session'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${trimmedPassword}`,
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 && typeof window !== 'undefined') {
          window.localStorage.removeItem(PASSWORD_STORAGE_KEY);
        }
        throw new Error(
          payload.error ||
            (response.status === 401
              ? 'Access code not recognized. Please try again.'
              : `Unable to start a session (status ${response.status}).`)
        );
      }

      const conversationId = payload.conversation_id ?? payload.id;
      if (!conversationId) {
        throw new Error('Conversation ID missing from server response.');
      }

      router.push(`/session/${conversationId}`);
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'We could not connect to the chat. Please try again.'
      );
      setIsStarting(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-100 px-4 py-8 text-neutral-900">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-xl">
        <header className="mb-6 space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Volunteer chat</p>
          <h1 className="text-2xl font-semibold text-neutral-900">Join your conversation with Alex</h1>
          <p className="text-sm text-neutral-500">
            You'll be speaking with Alex, a volunteer supporting our misinformation research.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex flex-col gap-2 text-left text-sm font-medium text-neutral-700">
            Access code
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              placeholder="Enter survey access code"
              autoComplete="current-password"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:bg-blue-300"
            disabled={isStarting}
          >
            {isStarting ? 'Connecting...' : 'Start chat'}
          </button>

          {errorMessage ? (
            <p className="text-center text-sm font-medium text-rose-500">{errorMessage}</p>
          ) : (
            <p className="text-center text-xs text-neutral-400">Everything you share stays between you and Alex.</p>
          )}
        </form>
      </div>
    </main>
  );
}
