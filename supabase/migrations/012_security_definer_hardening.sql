-- Harden SECURITY DEFINER functions that were created without an explicit search_path
-- and restrict helper access to authenticated callers instead of PUBLIC.

ALTER FUNCTION public.are_friends(UUID, UUID) SET search_path = public;
ALTER FUNCTION public.is_group_member(UUID, UUID) SET search_path = public;
ALTER FUNCTION public.is_group_admin(UUID, UUID) SET search_path = public;
ALTER FUNCTION public.can_access_expense(UUID, UUID) SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.delete_account() SET search_path = public;

REVOKE ALL ON FUNCTION public.are_friends(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_group_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_group_admin(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_expense(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.are_friends(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_expense(UUID, UUID) TO authenticated;

-- Revoke default PUBLIC access on the helper functions used by RLS policies.
-- Policies still execute correctly for authenticated callers.
