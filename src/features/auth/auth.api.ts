import { get, post } from '@shared/api/client';
import { EP } from '@shared/constants/endpoints';
import type { Agent } from '@shared/session/session';

export interface LoginRequest {
  phone: string;
  pin: string;
}

export interface LoginResponse {
  token: string;
  agent: Agent;
}

export function login(body: LoginRequest): Promise<LoginResponse> {
  return post<LoginResponse>(EP.login, body);
}

export function me(): Promise<Agent> {
  return get<Agent>(EP.me);
}
