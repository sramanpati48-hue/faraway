-- Sahayak (Nyay Guide) victim↔guide textual chat + shared unread tracking

CREATE TABLE IF NOT EXISTS public.sahayak_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  victim_user_id text NOT NULL,
  sahayak_user_id text NOT NULL,
  sahayak_case_id text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sahayak_threads_pair UNIQUE (victim_user_id, sahayak_user_id)
);

CREATE INDEX IF NOT EXISTS idx_sahayak_threads_victim ON public.sahayak_threads (victim_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sahayak_threads_sahayak ON public.sahayak_threads (sahayak_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sahayak_threads_case ON public.sahayak_threads (sahayak_case_id)
  WHERE sahayak_case_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_sahayak_threads_updated_at ON public.sahayak_threads;
CREATE TRIGGER trg_sahayak_threads_updated_at
BEFORE UPDATE ON public.sahayak_threads
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.sahayak_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.sahayak_threads(id) ON DELETE CASCADE,
  sender_user_id text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sahayak_messages_thread
  ON public.sahayak_messages (thread_id, created_at ASC);

-- Shared read watermarks for lawyer + sahayak chats (header unread badges)
CREATE TABLE IF NOT EXISTS public.chat_thread_reads (
  channel text NOT NULL CHECK (channel IN ('lawyer', 'sahayak')),
  thread_id uuid NOT NULL,
  user_id text NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_thread_reads_user
  ON public.chat_thread_reads (user_id, channel, last_read_at DESC);
