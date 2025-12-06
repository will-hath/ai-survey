'use client';

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { resolveApiUrl, SHARED_PASSWORD } from '@/lib/api';
import {
  Agent,
  Belief,
  getAgentByKey,
  getBeliefByKey,
  loadSessionMetadata,
  parseSurveyParams,
  persistSessionMetadata,
} from '@/lib/scenarios';

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
  const searchParams = useSearchParams();
  const { agentKey: queryAgentKey, beliefKey: queryBeliefKey, responderId: responderIdFromQuery } = useMemo(
    () => parseSurveyParams(searchParams),
    [searchParams]
  );

  const [agent, setAgent] = useState<Agent | null>(() => getAgentByKey(queryAgentKey));
  const [belief, setBelief] = useState<Belief | null>(() => getBeliefByKey(queryBeliefKey));
  const [responderId, setResponderId] = useState(responderIdFromQuery ?? '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Loading previous messages...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const hostFullName = agent?.displayName ?? null;
  const hostDisplayName = hostFullName ?? 'your research partner';
  const hostFirstName = hostFullName?.split(' ')[0] ?? hostDisplayName;
  const hostTitle = agent?.title ?? 'Volunteer researcher';
  const hostAvatarInitials = agent?.avatarInitials ?? 'AV';
  const sharedPassword = SHARED_PASSWORD?.trim() || null;

  const listRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (queryAgentKey) {
      setAgent(getAgentByKey(queryAgentKey));
    }
    if (queryBeliefKey) {
      setBelief(getBeliefByKey(queryBeliefKey));
    }
    if (responderIdFromQuery) {
      setResponderId(responderIdFromQuery);
    }
  }, [queryAgentKey, queryBeliefKey, responderIdFromQuery]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }
    const stored = loadSessionMetadata(conversationId);
    if (!stored) {
      return;
    }
    setResponderId((current) => current || stored.responderId);
    setAgent((current) => current ?? getAgentByKey(stored.agentKey));
    setBelief((current) => current ?? getBeliefByKey(stored.beliefKey));
  }, [conversationId]);

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

      setIsLoadingHistory(true);
      setStatusMessage('Loading previous messages...');
      setErrorMessage(null);

      try {
        const headers: Record<string, string> = {};
        if (sharedPassword) {
          headers.Authorization = `Bearer ${sharedPassword}`;
        }
        const response = await fetch(resolveApiUrl(`session/${conversationId}`), {
          method: 'GET',
          headers,
        });
        const payload = await response.json().catch(() => ({}));

        if (response.status === 401) {
          if (isMounted) {
            setErrorMessage('Access denied. Contact the research team.');
            setMessages([]);
            setStatusMessage('');
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
        const metadata = payload.metadata;
        if (metadata?.agent) {
          setAgent(metadata.agent as Agent);
        }
        if (metadata?.belief) {
          setBelief(metadata.belief as Belief);
        }
        if (metadata?.responderId) {
          setResponderId(metadata.responderId);
        }
        if (
          conversationId &&
          metadata?.responderId &&
          metadata?.agentKey &&
          metadata?.beliefKey
        ) {
          persistSessionMetadata(conversationId, {
            responderId: metadata.responderId,
            agentKey: metadata.agentKey,
            beliefKey: metadata.beliefKey,
          });
        }
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

        const displayAgent = metadata?.agent ?? agent;
        const displayName =
          (displayAgent?.displayName as string | undefined) ?? 'your research partner';
        const firstName = displayName.split(' ')[0] ?? displayName;
        setStatusMessage(`${firstName} is online. Share whenever you're ready.`);
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
  }, [conversationId, sharedPassword]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!conversationId || isProcessing || isLoadingHistory) {
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
    setStatusMessage(`${hostFirstName} is drafting a reply...`);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (sharedPassword) {
        headers.Authorization = `Bearer ${sharedPassword}`;
      }
      const response = await fetch(resolveApiUrl(`session/${conversationId}/message`), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: trimmed,
          responderId,
          agentKey: agent?.key,
          beliefKey: belief?.key,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) {
        setErrorMessage('Access denied. Contact the research team.');
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
    if (isLoadingHistory) {
      return 'Loading previous messages...';
    }
    if (isProcessing) {
      return `${hostFirstName} is drafting a reply...`;
    }
    if (errorMessage) {
      return 'Message not sent. You can try again.';
    }
    return null;
  }, [conversationId, errorMessage, isLoadingHistory, isProcessing]);

  return (
    <main className="flex min-h-screen flex-col bg-neutral-100 px-3 py-6 text-neutral-900 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-xl">
        <header className="flex flex-col gap-4 border-b border-neutral-200 bg-neutral-50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white sm:flex">
              {hostAvatarInitials}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                {hostTitle}
              </p>
              <h1 className="text-xl font-semibold text-neutral-900">Chat with {hostDisplayName}</h1>
              <p className="text-sm text-neutral-500">
                You&apos;re connected with {hostDisplayName}
                {belief ? ` to discuss ${belief.name}.` : ', a volunteer helping our misinformation study.'}
              </p>
              {belief?.summary ? (
                <p className="text-xs text-neutral-400">{belief.summary}</p>
              ) : null}
              {conversationId ? (
                <p className="text-xs text-neutral-400">
                  Conversation ID -{' '}
                  <code className="rounded bg-white px-2 py-1 text-xs text-neutral-600">{conversationId}</code>
                </p>
              ) : null}
            </div>
          </div>
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
                        {isUser ? 'You' : hostDisplayName}
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
