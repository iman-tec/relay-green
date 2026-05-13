-- Adds the 'super_admin' role to public.user_roles role check constraint.
-- Super Admin is the top-level platform owner: creates Orgs, creates the
-- first Enterprise Admin per Org, and manages all internal staff. Below
-- super_admin in privilege: ops_manager (internal admin), pod_lead
-- (supervisor), engineer, builder/customer.

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_role_check;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN (
    'super_admin',
    'admin',
    'ops_manager',
    'pod_lead',
    'engineer',
    'builder'
  ));
