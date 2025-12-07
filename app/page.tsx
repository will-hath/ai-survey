'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { resolveApiUrl, SHARED_PASSWORD, DEFAULT_SURVEY_HANDOFF_URL } from '@/lib/api';
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
  const {
    agentKey,
    beliefKey,
    responderId: responderIdFromQuery,
    handoffUrl: handoffUrlFromQuery,
  } = useMemo(
    () => parseSurveyParams(searchParams),
    [searchParams]
  );
  const agent = useMemo(() => getAgentByKey(agentKey), [agentKey]);
  const belief = useMemo(() => getBeliefByKey(beliefKey), [beliefKey]);
  const [participantName, setParticipantName] = useState('');
  const [responderId, setResponderId] = useState(responderIdFromQuery ?? '');
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (responderIdFromQuery) {
      setResponderId(responderIdFromQuery);
    }
  }, [responderIdFromQuery]);

  const hostFullName = agent?.displayName ?? null;
  const hostDisplayName = hostFullName ?? 'your research partner';
  const hostFirstName = hostFullName?.split(' ')[0] ?? hostDisplayName;
  const hostTitle = agent?.title ?? 'Volunteer researcher';
  const hostSummary =
    agent?.description ?? "You'll be speaking with a volunteer supporting our misinformation research.";
  const handoffUrl = handoffUrlFromQuery?.trim() || DEFAULT_SURVEY_HANDOFF_URL;
  const trimmedParticipantName = participantName.trim();
  const assignmentReady = Boolean(
    agent && belief && responderId.trim().length > 0 && trimmedParticipantName.length > 0
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isStarting) {
      return;
    }

    if (!trimmedParticipantName) {
      setErrorMessage(`Enter the name you'd like ${hostFirstName} to use.`);
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
      const sharedPassword = SHARED_PASSWORD?.trim();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (sharedPassword) {
        headers.Authorization = `Bearer ${sharedPassword}`;
      }

      const response = await fetch(resolveApiUrl('session'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          participantName: trimmedParticipantName,
          responderId: trimmedResponderId,
          agentKey: agent.key,
          beliefKey: belief.key,
          handoffUrl,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.error ||
            (response.status === 401
              ? 'Survey access was denied. Contact the research team.'
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
          handoffUrl: sessionMetadata.handoffUrl ?? handoffUrl,
        });
      }

      const queryString = buildSessionQuery(
        sessionMetadata?.agentKey ?? agent.key,
        sessionMetadata?.beliefKey ?? belief.key,
        sessionMetadata?.responderId ?? trimmedResponderId,
        sessionMetadata?.handoffUrl ?? handoffUrl
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
          <h1 className="text-2xl font-semibold text-neutral-900">
            Join the chat session with {hostDisplayName}
          </h1>
          <p className="text-sm text-neutral-500">{hostSummary}</p>
        </header>

        <section className="mb-6 space-y-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-left text-sm text-neutral-700">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Partner</p>
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
              placeholder={`Enter the name you'd like ${hostFirstName} to use`}
              autoComplete="name"
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
