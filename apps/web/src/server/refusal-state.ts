// A refusal as a form's state carries it to the page: its catalogue key,
// and the limit it names when it is one (R-162), for the message's {limit}.

interface RefusalState<K extends string> {
  readonly refusal: K;
  readonly limit?: number;
}

/** `refusal`, a domain refusal value, as a form's state. */
export function refusalState<K extends string>(refusal: {
  readonly reason: K;
  readonly limit?: number;
}): RefusalState<K> {
  return refusal.limit === undefined
    ? { refusal: refusal.reason }
    : { refusal: refusal.reason, limit: refusal.limit };
}
