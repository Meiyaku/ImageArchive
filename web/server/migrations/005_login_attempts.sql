-- Every sign-in attempt, for the admin's sign-in log. Pruned after 90 days.
CREATE TABLE login_attempts (
  id         BIGSERIAL PRIMARY KEY,
  -- What was typed, so attempts on accounts that don't exist show up too.
  username   TEXT NOT NULL,
  -- Set when the username matched an account (even if the password was wrong).
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  result     TEXT NOT NULL CHECK (result IN ('success', 'failed', 'throttled')),
  ip         TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_created_at_idx ON login_attempts (created_at DESC);
