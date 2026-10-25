// The model interface the handlers use. Real in production (lib/llm/gemini.ts), a fake in tests.

export interface GenRequest {
  system: string;
  /** Alternating conversation, oldest first. Applicant text is only ever inside a user turn, as data. */
  contents: { role: "user" | "model"; text: string }[];
  /** JSON Schema for the reply (structured output). */
  schema?: unknown;
  /** Function declarations: the model must call one of them. */
  tools?: unknown[];
  maxOutputTokens?: number;
}

export interface GenResult {
  text: string | null;
  call: { name: string; args: unknown } | null;
}

export interface GeminiClient {
  readonly model: string;
  generate(req: GenRequest): Promise<GenResult>;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** A route's answer as plain data: the route file turns it into a Response. */
export interface Reply {
  status: number;
  body: unknown;
}
