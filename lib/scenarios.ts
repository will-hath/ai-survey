import rawConfig from '@/config/scenarios.json';
import { ReadonlyURLSearchParams } from 'next/navigation';

export type Agent = {
  key: string;
  slug: string;
  displayName: string;
  title: string;
  avatarInitials: string;
  promptId: string;
  introMessage: string;
  description?: string;
};

export type Belief = {
  key: string;
  name: string;
  docUrl: string;
  summary?: string;
};

export type SurveyConfig = {
  agents: Record<string, Agent>;
  beliefs: Record<string, Belief>;
};

export type StoredSessionMetadata = {
  responderId: string;
  agentKey: string;
  beliefKey: string;
  handoffUrl?: string;
};

const config = rawConfig as SurveyConfig;

export const SURVEY_QUERY_KEYS = {
  agent: 'a',
  belief: 'b',
  responder: 'responder_id',
  responderAlt: 'rid',
  handoff: 'handoff',
};

const SESSION_STORAGE_PREFIX = 'survey-session-meta';

export const listAgents = () => Object.values(config.agents);
export const listBeliefs = () => Object.values(config.beliefs);

export const getAgentByKey = (key?: string | null): Agent | null => {
  if (!key) {
    return null;
  }
  return config.agents[key] ?? null;
};

export const getBeliefByKey = (key?: string | null): Belief | null => {
  if (!key) {
    return null;
  }
  return config.beliefs[key] ?? null;
};

export const parseSurveyParams = (searchParams: ReadonlyURLSearchParams | null) => {
  const agentKey = searchParams?.get(SURVEY_QUERY_KEYS.agent) ?? null;
  const beliefKey = searchParams?.get(SURVEY_QUERY_KEYS.belief) ?? null;
  const responderId =
    searchParams?.get(SURVEY_QUERY_KEYS.responder) ??
    searchParams?.get(SURVEY_QUERY_KEYS.responderAlt) ??
    null;
  const handoffUrl = searchParams?.get(SURVEY_QUERY_KEYS.handoff) ?? null;

  return { agentKey, beliefKey, responderId, handoffUrl };
};

const sessionKey = (conversationId: string) => `${SESSION_STORAGE_PREFIX}:${conversationId}`;

export const persistSessionMetadata = (
  conversationId: string,
  metadata: StoredSessionMetadata
) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.setItem(sessionKey(conversationId), JSON.stringify(metadata));
  } catch (error) {
    console.warn('Unable to persist session metadata', error);
  }
};

export const loadSessionMetadata = (
  conversationId: string
): StoredSessionMetadata | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(sessionKey(conversationId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as StoredSessionMetadata;
  } catch (error) {
    console.warn('Unable to load session metadata', error);
    return null;
  }
};

export const clearSessionMetadata = (conversationId: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.removeItem(sessionKey(conversationId));
  } catch (error) {
    console.warn('Unable to clear session metadata', error);
  }
};

export const buildSessionQuery = (
  agentKey?: string | null,
  beliefKey?: string | null,
  responderId?: string | null,
  handoffUrl?: string | null
) => {
  const params = new URLSearchParams();
  if (agentKey) {
    params.set(SURVEY_QUERY_KEYS.agent, agentKey);
  }
  if (beliefKey) {
    params.set(SURVEY_QUERY_KEYS.belief, beliefKey);
  }
  if (responderId) {
    params.set(SURVEY_QUERY_KEYS.responder, responderId);
  }
  if (handoffUrl) {
    params.set(SURVEY_QUERY_KEYS.handoff, handoffUrl);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};
