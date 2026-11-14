-- Student directory, privacy preferences, avatar storage and admin-to-user notices.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS institution text NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS friend_requests_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_data text;
ALTER TABLE public.study_notifications ADD COLUMN IF NOT EXISTS target_user_id bigint REFERENCES public.profiles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS profiles_institution_role_sort ON public.profiles (lower(institution), role, lower(department), lower(batch), lower(name));
CREATE INDEX IF NOT EXISTS study_notifications_target_time ON public.study_notifications (target_user_id, id DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_avatar_data_size') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_data_size CHECK (avatar_data IS NULL OR length(avatar_data) <= 180000);
  END IF;
END $$;
