export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string;
  retryable?: boolean;
}

const BASE = 'https://errors.collection-copilot/';

export const problem = (status: number, slug: string, title: string, detail?: string): Problem => ({
  type: BASE + slug,
  title,
  status,
  ...(detail ? { detail } : {}),
});
