-- Give every profile an explicit institution category for registration,
-- profile management, institution matching, and CR board isolation.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS institution_type text NOT NULL DEFAULT 'University';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_institution_type_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_institution_type_check
      CHECK (institution_type IN ('School', 'College', 'University', 'Coaching Centre'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS profiles_institution_type_role_sort
  ON public.profiles (lower(institution_type), lower(institution), role, lower(department), lower(batch), lower(name));

ALTER TABLE public.cr_community_messages
  ADD COLUMN IF NOT EXISTS institution_type text NOT NULL DEFAULT 'University';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cr_community_institution_type_check'
      AND conrelid = 'public.cr_community_messages'::regclass
  ) THEN
    ALTER TABLE public.cr_community_messages
      ADD CONSTRAINT cr_community_institution_type_check
      CHECK (institution_type IN ('School', 'College', 'University', 'Coaching Centre'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cr_community_type_institution_time
  ON public.cr_community_messages (lower(institution_type), lower(institution), id DESC);
