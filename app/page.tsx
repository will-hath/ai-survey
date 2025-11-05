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
      setErrorMessage('Enter the access password to start a session.');
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
              ? 'Incorrect password. Please try again.'
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
          : 'Something went wrong while starting your session.'
      );
      setIsStarting(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8 rounded-3xl border border-slate-800/70 bg-slate-900/60 p-10 text-center shadow-[0_45px_120px_rgba(15,23,42,0.65)] backdrop-blur">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold sm:text-4xl">Controversial Opinions</h1>
          <p className="text-base text-slate-400 sm:text-lg">
            Start a new session whenever you are ready.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex w-full flex-col items-center gap-4">
          <label className="w-full text-left text-sm font-medium text-slate-300">
            Access password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/50"
              placeholder="Enter the shared password"
              autoComplete="current-password"
            />
          </label>

          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-6 py-3 text-base font-semibold text-sky-950 shadow-lg shadow-sky-900/40 transition hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isStarting}
          >
            {isStarting ? 'Preparing your session…' : 'Start session'}
          </button>
          {errorMessage ? (
            <p className="text-sm font-medium text-rose-400">{errorMessage}</p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
