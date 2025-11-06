'use client';

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { resolveApiUrl, PASSWORD_STORAGE_KEY } from '@/lib/api';

type MessageRole = 'user' | 'assistant';

type Message = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
};

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export default function SessionPage() {
  const params = useParams();
  const rawConversationId = params?.conversationId;
  const conversationId = Array.isArray(rawConversationId)
    ? rawConversationId[0]
    : rawConversationId;

  const [password, setPassword] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [isPasswordReady, setIsPasswordReady] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Loading conversation…');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const listRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const stored = window.localStorage.getItem(PASSWORD_STORAGE_KEY);
    if (stored) {
      setPassword(stored);
      setPasswordInput(stored);
    }
    setIsPasswordReady(true);
  }, []);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  useEffect(() => {
    if (!isPasswordReady) {
      return;
    }

    let isMounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const fetchConversation = async () => {
      if (!conversationId) {
        if (isMounted) {
          setErrorMessage('Conversation ID missing from the URL.');
          setStatusMessage('');
          setIsLoadingHistory(false);
        }
        return;
      }

      if (!password) {
        if (isMounted) {
          setIsLoadingHistory(false);
          setStatusMessage('');
          setPasswordError('Enter the access password to view this conversation.');
        }
        return;
      }

      setIsLoadingHistory(true);
      setStatusMessage('Loading conversation…');
      setErrorMessage(null);
      setPasswordError(null);

      try {
        const response = await fetch(resolveApiUrl(`session/${conversationId}`), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${password}`,
          },
        });
        const payload = await response.json().catch(() => ({}));

        if (response.status === 401) {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(PASSWORD_STORAGE_KEY);
          }
          if (isMounted) {
            setPassword(null);
            setPasswordInput('');
            setPasswordError('Unauthorized. Check the access password.');
            setMessages([]);
            setStatusMessage('');
            setErrorMessage(null);
          }
          return;
        }

        if (!response.ok) {
          const message =
            payload.error ||
            (response.status === 404
              ? 'Conversation not found.'
              : `Unable to load conversation (status ${response.status}).`);
          throw new Error(message);
        }

        const history = Array.isArray(payload.messages) ? payload.messages : [];
        const assembledMessages: Message[] = history.map((item: any) => ({
          id: typeof item.id === 'string' ? item.id : createId(),
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: typeof item.content === 'string' ? item.content : '',
          timestamp:
            typeof item.created_at === 'number'
              ? item.created_at * 1000
              : Date.now(),
        }));

        if (!isMounted) {
          return;
        }

        setMessages(assembledMessages);

        setStatusMessage('Type your message below');
        timeoutId = setTimeout(() => {
          setStatusMessage('');
        }, 2500);
      } catch (error) {
        console.error(error);
        if (isMounted) {
          setErrorMessage(
            error instanceof Error ? error.message : 'Failed to load this conversation.'
          );
          setStatusMessage('');
          setMessages([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingHistory(false);
        }
      }
    };

    fetchConversation();

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [conversationId, password, isPasswordReady]);

  const handlePasswordFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = passwordInput.trim();
    if (!trimmed) {
      setPasswordError('Enter the access password to continue.');
      return;
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PASSWORD_STORAGE_KEY, trimmed);
    }
    setPassword(trimmed);
    setPasswordInput(trimmed);
    setPasswordError(null);
    setErrorMessage(null);
    setStatusMessage('Loading conversation…');
    setIsLoadingHistory(true);
  };

  const handlePasswordReset = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(PASSWORD_STORAGE_KEY);
    }
    setPassword(null);
    setPasswordInput('');
    setPasswordError(null);
    setErrorMessage(null);
    setStatusMessage('');
    setMessages([]);
    setIsProcessing(false);
    setIsLoadingHistory(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!conversationId || isProcessing || isLoadingHistory) {
      return;
    }

    if (!password) {
      setPasswordError('Enter the access password to continue.');
      setErrorMessage('Access password required.');
      return;
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return;
    }

    const userMessage: Message = {
      id: createId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((current) => [...current, userMessage]);
    setInput('');
    setIsProcessing(true);
    setStatusMessage('Typing...');
    setErrorMessage(null);
    setPasswordError(null);

    try {
      const response = await fetch(resolveApiUrl(`session/${conversationId}/message`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${password}`,
        },
        body: JSON.stringify({ message: trimmed }),
      });

      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(PASSWORD_STORAGE_KEY);
        }
        setPassword(null);
        setPasswordInput('');
        setPasswordError('Unauthorized. Check the access password.');
        setErrorMessage('Unauthorized. Check the access password.');
        setStatusMessage('');
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
        return;
      }

      if (!response.ok) {
        const errorText =
          payload.error || `Message failed with status ${response.status}`;
        throw new Error(errorText);
      }

      const replyText: string =
        typeof payload.response === 'string'
          ? payload.response
          : Array.isArray(payload.response)
          ? payload.response.join('\n')
          : 'I’m not sure how to respond to that.';

      const assistantMessage: Message = {
        id: createId(),
        role: 'assistant',
        content: replyText,
        timestamp: Date.now(),
      };

      setMessages((current) => [...current, assistantMessage]);
      setStatusMessage('');
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : 'Something went wrong. Please start a new session and try again.';
      setErrorMessage(message);
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'assistant',
          content: 'Sorry, I ran into an issue. Please start a new session and try again.',
          timestamp: Date.now(),
        },
      ]);
      setStatusMessage('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (formRef.current) {
        formRef.current.requestSubmit();
      }
    }
  };

  const disabledReason = useMemo(() => {
    if (!conversationId) {
      return 'Conversation is unavailable.';
    }
    if (!password) {
      return 'Enter the access password to continue.';
    }
    if (isLoadingHistory) {
      return 'Loading conversation…';
    }
    if (isProcessing) {
      return ' Typing...';
    }
    if (errorMessage) {
      return 'We hit a snag, but you can try sending another message.';
    }
    return null;
  }, [conversationId, errorMessage, isLoadingHistory, isProcessing, password]);

  const showPasswordPrompt = isPasswordReady && !password;

  if (showPasswordPrompt) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8 rounded-3xl border border-slate-800/70 bg-slate-900/60 p-8 text-center shadow-[0_45px_120px_rgba(15,23,42,0.65)] backdrop-blur">
          <header className="flex flex-col gap-3">
            <h1 className="text-3xl font-semibold sm:text-4xl">Unlock Conversation</h1>
            <p className="text-base text-slate-400 sm:text-lg">
              Enter the shared password to access conversation{' '}
              <code className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-200">
                {conversationId}
              </code>
              .
            </p>
          </header>

          <form onSubmit={handlePasswordFormSubmit} className="flex w-full flex-col items-center gap-4">
            <label className="w-full text-left text-sm font-medium text-slate-300">
              Access password
              <input
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/50"
                placeholder="Enter the shared password"
                autoComplete="current-password"
              />
            </label>

            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-6 py-3 text-base font-semibold text-sky-950 shadow-lg shadow-sky-900/40 transition hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              Unlock conversation
            </button>
            {passwordError ? (
              <p className="text-sm font-medium text-rose-400">{passwordError}</p>
            ) : null}
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 px-4 py-10 text-slate-100 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 rounded-3xl border border-slate-800/70 bg-slate-900/60 p-6 shadow-[0_45px_120px_rgba(15,23,42,0.65)] backdrop-blur">
        <header className="flex flex-col gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold sm:text-3xl">Controversial Opinions</h1>
            <p className="text-sm text-slate-400 sm:text-base">
              Talk about your most controversial opinions with experts.
            </p>
          </div>
          <button
            type="button"
            onClick={handlePasswordReset}
            className="self-start rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-sky-400 hover:text-sky-300"
          >
            Change password
          </button>
        </header>

        <section
          ref={listRef}
          className="flex-1 overflow-y-auto rounded-2xl border border-slate-800/60 bg-slate-950/60 p-4 shadow-inner"
          aria-live="polite"
        >
          {isLoadingHistory ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Loading conversation…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              {errorMessage || 'Say hello to get started!'}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((message) => {
                const isUser = message.role === 'user';
                return (
                  <article
                    key={message.id}
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg transition ${
                      isUser
                        ? 'self-end bg-sky-500 text-sky-950 shadow-sky-900/40'
                        : 'self-start border border-slate-800 bg-slate-900/80 text-slate-100'
                    }`}
                  >
                    <header className="mb-1 text-xs uppercase tracking-wide text-slate-300/80">
                      {isUser ? 'You' : 'Anonymous'}
                    </header>
                    <p>{message.content}</p>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="space-y-3 rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4 shadow-inner"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              {statusMessage || disabledReason || 'Type your message below'}
            </span>
            {errorMessage ? (
              <span className="text-xs font-medium text-rose-400">{errorMessage}</span>
            ) : null}
          </div>

          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isLoadingHistory
                ? 'Loading conversation…'
                : conversationId
                ? 'Type your message here'
                : 'Conversation unavailable.'
            }
            rows={3}
            className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm leading-relaxed text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!conversationId || isProcessing || isLoadingHistory}
          />

          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-sky-950 shadow-lg shadow-sky-900/40 transition hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!conversationId || isProcessing || isLoadingHistory}
            >
              {isProcessing ? 'Thinking…' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
