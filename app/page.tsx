'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { resolveApiUrl, PASSWORD_STORAGE_KEY, PARTICIPANT_NAME_STORAGE_KEY } from '@/lib/api';
import {
  buildSessionQuery,
  getAgentByKey,
  getBeliefByKey,
  parseSurveyParams,
  persistSessionMetadata,
} from '@/lib/scenarios';

export default function WelcomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { agentKey, beliefKey, responderId: responderIdFromQuery } = useMemo(
    () => parseSurveyParams(searchParams),
    [searchParams]
  );
  const agent = useMemo(() => getAgentByKey(agentKey), [agentKey]);
  const belief = useMemo(() => getBeliefByKey(beliefKey), [beliefKey]);
  const [participantName, setParticipantName] = useState('');
  const [password, setPassword] = useState('');
  const [responderId, setResponderId] = useState(responderIdFromQuery ?? '');
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedName = window.localStorage.getItem(PARTICIPANT_NAME_STORAGE_KEY);
    if (storedName) {
      setParticipantName(storedName);
    }
    const stored = window.localStorage.getItem(PASSWORD_STORAGE_KEY);
    if (stored) {
      setPassword(stored);
    }
  }, []);

  useEffect(() => {
    if (responderIdFromQuery) {
      setResponderId(responderIdFromQuery);
    }
  }, [responderIdFromQuery]);

  const hostFullName = agent?.displayName ?? 'Alex Vega';
  const hostFirstName = hostFullName.split(' ')[0] ?? hostFullName;
  const hostTitle = agent?.title ?? 'Volunteer researcher';
  const hostSummary =
    agent?.description ??
    "You'll be speaking with Alex, a volunteer supporting our misinformation research.";
  const assignmentReady = Boolean(agent && belief && responderId.trim().length > 0);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isStarting) {
      return;
    }

    const trimmedName = participantName.trim();
    if (!trimmedName) {
      setErrorMessage('Enter your name to continue.');
      return;
    }

    const trimmedPassword = password.trim();
    if (!trimmedPassword) {
      setErrorMessage('Enter the survey access code to continue.');
      return;
    }

    const trimmedResponderId = responderId.trim();
    if (!trimmedResponderId) {
      setErrorMessage('Missing responder ID. Please use the original survey link.');
      return;
    }

    if (!agent || !belief) {
      setErrorMessage('This survey link is missing assignment information.');
      return;
    }

    setIsStarting(true);
    setErrorMessage(null);

    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(PARTICIPANT_NAME_STORAGE_KEY, trimmedName);
        window.localStorage.setItem(PASSWORD_STORAGE_KEY, trimmedPassword);
      }

      const response = await fetch(resolveApiUrl('session'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${trimmedPassword}`,
        },
        body: JSON.stringify({
          participantName: trimmedName,
          responderId: trimmedResponderId,
          agentKey: agent.key,
          beliefKey: belief.key,
        }),
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

      const sessionMetadata = payload.metadata;
      if (
        sessionMetadata?.responderId &&
        sessionMetadata?.agentKey &&
        sessionMetadata?.beliefKey
      ) {
        persistSessionMetadata(conversationId, {
          responderId: sessionMetadata.responderId,
          agentKey: sessionMetadata.agentKey,
          beliefKey: sessionMetadata.beliefKey,
        });
      }

      const queryString = buildSessionQuery(
        sessionMetadata?.agentKey ?? agent.key,
        sessionMetadata?.beliefKey ?? belief.key,
        sessionMetadata?.responderId ?? trimmedResponderId
      );

      router.push(`/session/${conversationId}${queryString}`);
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
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{hostTitle}</p>
          <h1 className="text-2xl font-semibold text-neutral-900">
            Join your conversation with {hostFullName}
          </h1>
          <p className="text-sm text-neutral-500">{hostSummary}</p>
        </header>

        <section className="mb-6 space-y-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-left text-sm text-neutral-700">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Character</p>
            {agent ? (
              <div className="mt-1">
                <p className="font-semibold text-neutral-900">{agent.displayName}</p>
                <p className="text-xs text-neutral-500">{agent.title}</p>
              </div>
            ) : (
              <p className="mt-1 text-rose-500">Missing character assignment. Use your survey link.</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Topic</p>
            {belief ? (
              <div className="mt-1">
                <p className="font-semibold text-neutral-900">{belief.name}</p>
                <p className="text-xs text-neutral-500">{belief.summary}</p>
              </div>
            ) : (
              <p className="mt-1 text-rose-500">Missing topic assignment. Use your survey link.</p>
            )}
          </div>
          <div>
            <label className="flex flex-col gap-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Responder ID
              <input
                type="text"
                value={responderId}
                onChange={(event) => setResponderId(event.target.value)}
                className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-normal text-neutral-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                placeholder="Missing responder ID"
              />
            </label>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex flex-col gap-2 text-left text-sm font-medium text-neutral-700">
            Your name
            <input
              type="text"
              value={participantName}
              onChange={(event) => setParticipantName(event.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              placeholder={`Enter the name you\u2019d like ${hostFirstName} to use`}
              autoComplete="name"
            />
          </label>

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
            disabled={isStarting || !assignmentReady}
          >
            {isStarting ? 'Connecting...' : 'Start chat'}
          </button>

          {errorMessage ? (
            <p className="text-center text-sm font-medium text-rose-500">{errorMessage}</p>
          ) : (
            <p className="text-center text-xs text-neutral-400">
              Everything you share stays between you, {hostFirstName}, and the research team.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
