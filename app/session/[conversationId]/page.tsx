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

const HOST_FULL_NAME = 'Alex Vega';
const HOST_FIRST_NAME = 'Alex';
const HOST_TITLE = 'Volunteer researcher';
const HOST_AVATAR_INITIALS = 'AV';

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
  const [statusMessage, setStatusMessage] = useState('Loading previous messages...');
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
          setPasswordError('Enter the access code to view this chat.');
        }
        return;
      }

      setIsLoadingHistory(true);
      setStatusMessage('Loading previous messages...');
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
            setPasswordError('Access denied. Check the code.');
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

        setStatusMessage(`${HOST_FIRST_NAME} is online. Share whenever you're ready.`);
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
      setPasswordError('Enter the access code to continue.');
      return;
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PASSWORD_STORAGE_KEY, trimmed);
    }
    setPassword(trimmed);
    setPasswordInput(trimmed);
    setPasswordError(null);
    setErrorMessage(null);
    setStatusMessage('Loading previous messages...');
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
      setPasswordError('Enter the access code to continue.');
      setErrorMessage('Access code required.');
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
    setStatusMessage(`${HOST_FIRST_NAME} is drafting a reply...`);
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
        setPasswordError('Access denied. Check the code.');
        setErrorMessage('Access denied. Check the code.');
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
          : "I'm not sure how to respond to that.";

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
      return 'Conversation unavailable.';
    }
    if (!password) {
      return 'Unlock the chat to continue.';
    }
    if (isLoadingHistory) {
      return 'Loading previous messages...';
    }
    if (isProcessing) {
      return `${HOST_FIRST_NAME} is drafting a reply...`;
    }
    if (errorMessage) {
      return 'Message not sent. You can try again.';
    }
    return null;
  }, [conversationId, errorMessage, isLoadingHistory, isProcessing, password]);

  const showPasswordPrompt = isPasswordReady && !password;

  if (showPasswordPrompt) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-100 px-4 py-8 text-neutral-900">
        <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-xl">
          <header className="mb-6 space-y-2 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Private chat access</p>
            <h1 className="text-2xl font-semibold text-neutral-900">Enter your access code</h1>
            <p className="text-sm text-neutral-500">Use the survey access code to continue.</p>
            {conversationId ? (
              <p className="text-xs text-neutral-400">
                Conversation ID -{' '}
                <code className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600">{conversationId}</code>
              </p>
            ) : null}
          </header>

          <form onSubmit={handlePasswordFormSubmit} className="space-y-4">
            <label className="flex flex-col gap-2 text-left text-sm font-medium text-neutral-700">
              Access code
              <input
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                placeholder="Enter survey access code"
                autoComplete="current-password"
              />
            </label>

            <button
              type="submit"
              className="w-full rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-white"
            >
              Unlock chat
            </button>
            {passwordError ? (
              <p className="text-center text-sm font-medium text-rose-500">{passwordError}</p>
            ) : null}
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-neutral-100 px-3 py-6 text-neutral-900 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-xl">
        <header className="flex flex-col gap-4 border-b border-neutral-200 bg-neutral-50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white sm:flex">
              {HOST_AVATAR_INITIALS}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                {HOST_TITLE}
              </p>
              <h1 className="text-xl font-semibold text-neutral-900">Chat with {HOST_FULL_NAME}</h1>
              <p className="text-sm text-neutral-500">
                You're connected with {HOST_FULL_NAME}, a volunteer helping our misinformation study.
              </p>
              {conversationId ? (
                <p className="text-xs text-neutral-400">
                  Conversation ID -{' '}
                  <code className="rounded bg-white px-2 py-1 text-xs text-neutral-600">{conversationId}</code>
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={handlePasswordReset}
            className="inline-flex items-center justify-center rounded-full border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100"
          >
            Switch access code
          </button>
        </header>

        <section
          ref={listRef}
          className="flex-1 overflow-y-auto bg-neutral-50 px-6 py-6"
          aria-live="polite"
        >
          {isLoadingHistory ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-500">
              Loading previous messages...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-500">
              {errorMessage || 'Send a note to get started.'}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((message) => {
                const isUser = message.role === 'user';
                const bubbleClasses = isUser
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white text-neutral-800 shadow-sm ring-1 ring-neutral-200';
                const nameClasses = isUser ? 'text-white/70' : 'text-neutral-500';

                return (
                  <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <article className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${bubbleClasses}`}>
                      <header className={`mb-1 text-xs font-medium ${nameClasses}`}>
                        {isUser ? 'You' : HOST_FULL_NAME}
                      </header>
                      <p>{message.content}</p>
                    </article>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="border-t border-neutral-200 bg-white px-6 py-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isLoadingHistory
                  ? 'Loading previous messages...'
                  : conversationId
                  ? 'Share your thoughts here'
                  : 'Conversation unavailable.'
              }
              rows={3}
              className="w-full resize-none rounded-2xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm leading-relaxed text-neutral-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-neutral-100"
              disabled={!conversationId || isProcessing || isLoadingHistory}
            />

            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:bg-blue-300"
              disabled={!conversationId || isProcessing || isLoadingHistory}
            >
              {isProcessing ? 'Sending...' : 'Send message'}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
            <span>{statusMessage || disabledReason || 'Press Enter to send - Shift+Enter for a new line.'}</span>
            {errorMessage ? (
              <span className="font-medium text-rose-500">{errorMessage}</span>
            ) : null}
          </div>
        </form>
      </div>
    </main>
  );
}
