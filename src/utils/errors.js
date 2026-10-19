/** An error whose message is safe and useful to show to people. */
export class UserError extends Error {
  /**
   * @param {string} message What happened, in plain words.
   * @param {string} [hint] What the person can do next.
   */
  constructor(message, hint = '') {
    super(message);
    this.name = 'UserError';
    this.hint = hint;
  }
}

export function describeError(err, fallback = 'Something went wrong.') {
  if (err instanceof UserError) return err.hint ? `${err.message} ${err.hint}` : err.message;
  if (err && err.name === 'QuotaExceededError') {
    return 'Your browser has no storage space left. Export a backup (.slt) and free up space.';
  }
  return fallback;
}
