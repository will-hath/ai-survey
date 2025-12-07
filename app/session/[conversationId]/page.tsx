'use client';

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  resolveApiUrl,
  SHARED_PASSWORD,
  CONVERSATION_SOFT_CAP_USER_MESSAGES,
  CONVERSATION_HARD_CAP_USER_MESSAGES,
  DEFAULT_SURVEY_HANDOFF_URL,
} from '@/lib/api';
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

const WORDS_PER_MINUTE = 100;
const AVERAGE_CHARACTERS_PER_WORD = 5;
const MS_PER_CHARACTER = 60000 / (WORDS_PER_MINUTE * AVERAGE_CHARACTERS_PER_WORD);
const calculateTypingDelay = (text: string) => {
  const characters = Math.max(text.length, 1);
  return Math.round(characters * MS_PER_CHARACTER);
};

const normalizeHandoffUrl = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const SURVEY_HANDOFF_PASSWORD = 'SURVEY-PASSWORD';
const SURVEY_HANDOFF_LINK_LABEL = 'Return to the Qualtrics survey';
const SOFT_CAP_NOTICE_HEADING = 'Plan your wrap-up';
const HARD_CAP_NOTICE_HEADING = 'Message limit reached';
const SOFT_CAP_NOTICE_BODY =
  'You can keep sending a few more messages, but please plan to return to the Qualtrics survey soon.';
const HARD_CAP_NOTICE_BODY =
  'This is the end of this chat. Please return to the Qualtrics survey now to continue the study.';

export default function SessionPage() {
  const params = useParams();
  const rawConversationId = params?.conversationId;
  const conversationId = Array.isArray(rawConversationId)
    ? rawConversationId[0]
    : rawConversationId;
  const searchParams = useSearchParams();
  const {
    agentKey: queryAgentKey,
    beliefKey: queryBeliefKey,
    responderId: responderIdFromQuery,
    handoffUrl: handoffUrlFromQuery,
  } = useMemo(
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
  const [handoffUrl, setHandoffUrl] = useState(
    normalizeHandoffUrl(handoffUrlFromQuery) ?? DEFAULT_SURVEY_HANDOFF_URL
  );

  const hostFullName = agent?.displayName ?? null;
  const hostDisplayName = hostFullName ?? 'your research partner';
  const hostFirstName = hostFullName?.split(' ')[0] ?? hostDisplayName;
  const hostTitle = agent?.title ?? 'Volunteer researcher';
  const hostAvatarInitials = agent?.avatarInitials ?? 'AV';
  const sharedPassword = SHARED_PASSWORD?.trim() || null;
  const softCapLimit = CONVERSATION_SOFT_CAP_USER_MESSAGES ?? null;
  const hardCapLimit = CONVERSATION_HARD_CAP_USER_MESSAGES ?? null;
  const userMessageCount = useMemo(
    () => messages.filter((message) => message.role === 'user').length,
    [messages]
  );
  const hasReachedSoftCap = softCapLimit !== null && userMessageCount >= softCapLimit;
  const hasReachedHardCap = hardCapLimit !== null && userMessageCount >= hardCapLimit;
  const showSoftCapNotice = hasReachedSoftCap && !hasReachedHardCap;
  const showHardCapNotice = hasReachedHardCap;
  const resolvedHandoffUrl = handoffUrl?.trim() || DEFAULT_SURVEY_HANDOFF_URL;
  const handoffUrlRef = useRef(resolvedHandoffUrl);
  useEffect(() => {
    handoffUrlRef.current = resolvedHandoffUrl;
  }, [resolvedHandoffUrl]);
  const agentRef = useRef<Agent | null>(agent);
  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

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
    const normalized = normalizeHandoffUrl(handoffUrlFromQuery);
    if (normalized) {
      setHandoffUrl(normalized);
    }
  }, [handoffUrlFromQuery]);

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
    const normalized = normalizeHandoffUrl(stored.handoffUrl);
    if (normalized) {
      setHandoffUrl(normalized);
    }
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
    if (hasReachedHardCap) {
      setStatusMessage('Message limit reached. Return to the survey to continue.');
      setErrorMessage(null);
    }
  }, [hasReachedHardCap]);

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
        const normalizedHandoff = normalizeHandoffUrl(metadata?.handoffUrl);
        if (normalizedHandoff) {
          setHandoffUrl(normalizedHandoff);
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
            handoffUrl: metadata.handoffUrl ?? handoffUrlRef.current,
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

        const displayAgent = metadata?.agent ?? agentRef.current ?? undefined;
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

    if (hasReachedHardCap) {
      setErrorMessage('Message limit reached. Please return to the survey to continue.');
      setStatusMessage('Message limit reached. Return to the survey to continue.');
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
      const requestStartedAt = Date.now();
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

      const targetDuration = calculateTypingDelay(replyText);
      const elapsed = Date.now() - requestStartedAt;
      const remainingDelay = Math.max(targetDuration - elapsed, 0);
      if (remainingDelay > 0) {
        setStatusMessage(`${hostFirstName} is drafting a reply...`);
        await new Promise((resolve) => setTimeout(resolve, remainingDelay));
      }

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
    if (hasReachedHardCap) {
      return 'Message limit reached. Return to the survey to continue.';
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
  }, [conversationId, errorMessage, hasReachedHardCap, hostFirstName, isLoadingHistory, isProcessing]);

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
          {showHardCapNotice ? (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              <p className="font-semibold text-rose-900">{HARD_CAP_NOTICE_HEADING}</p>
              <p className="mt-1 text-rose-800">{HARD_CAP_NOTICE_BODY}</p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                Survey password:{' '}
                <code className="ml-1 rounded bg-white px-2 py-1 text-[11px] text-rose-900">
                  {SURVEY_HANDOFF_PASSWORD}
                </code>
              </p>
              {resolvedHandoffUrl ? (
                <a
                  className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-rose-300 bg-white px-4 py-2 text-xs font-semibold text-rose-900 shadow-sm transition hover:bg-rose-50"
                  href={resolvedHandoffUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {SURVEY_HANDOFF_LINK_LABEL}
                </a>
              ) : null}
            </div>
          ) : null}

          {showSoftCapNotice ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold text-amber-900">{SOFT_CAP_NOTICE_HEADING}</p>
              <p className="mt-1 text-amber-800">{SOFT_CAP_NOTICE_BODY}</p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
                Survey password:{' '}
                <code className="ml-1 rounded bg-white/80 px-2 py-1 text-[11px] text-amber-900">
                  {SURVEY_HANDOFF_PASSWORD}
                </code>
              </p>
              {resolvedHandoffUrl ? (
                <a
                  className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-900 shadow-sm transition hover:bg-amber-50"
                  href={resolvedHandoffUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {SURVEY_HANDOFF_LINK_LABEL}
                </a>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                hasReachedHardCap
                  ? 'Message limit reached. Please return to the survey.'
                  : isLoadingHistory
                  ? 'Loading previous messages...'
                  : conversationId
                  ? 'Share your thoughts here'
                  : 'Conversation unavailable.'
              }
              rows={3}
              className="w-full resize-none rounded-2xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm leading-relaxed text-neutral-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-neutral-100"
              disabled={!conversationId || isProcessing || isLoadingHistory || hasReachedHardCap}
            />

            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:bg-blue-300"
              disabled={!conversationId || isProcessing || isLoadingHistory || hasReachedHardCap}
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
