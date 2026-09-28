-- handle_new_user() always wrote plan='free' to user_profiles, ignoring the
-- plan the signup form lets a user pick (raw_user_meta_data->>'plan'). That
-- pick only "stuck" via a client-side upsert AFTER signUp() returns a
-- session -- which never happens when email confirmation is required
-- (signUp() returns session=null until the user clicks the confirmation
-- link), so every confirmation-required signup silently lost its picked
-- plan. This makes the trigger itself the source of truth, so the row is
-- right immediately, session or not. Client-side selection is still just
-- a UI preference (billing/entitlements read from `subscriptions` — see
-- src/lib/stripe/entitlements.ts's own comment -- not from this column).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
begin
  insert into public.user_profiles (id, email, name, plan)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'plan', 'free')
  );
  return new;
end;
$function$;
