/** Every API error looks like this; `message` is ready to show (pt-BR). */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Validation problems by field path (no values echoed back). */
    fields?: { path: string; problem: string }[];
  };
}
