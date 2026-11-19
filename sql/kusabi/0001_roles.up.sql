-- 0001_roles (up): the four NOLOGIN roles of the `kusabi` place and what they may do on the database.
-- Run with psql -v ON_ERROR_STOP=1 -v migration_role=<role that runs 0001 and 0002> -v database=<database name>.
-- One transaction: if the owner cannot get CREATE on the database, nothing is left behind.
BEGIN;

CREATE ROLE kusabi_owner NOLOGIN;
CREATE ROLE kusabi_save_function_owner NOLOGIN;
CREATE ROLE kusabi_query_function_owner NOLOGIN;
CREATE ROLE kusabi_seat NOLOGIN;

-- The two function owners call the common verification through this role (it belongs to the common
-- infrastructure and is not created or dropped here). The role that runs this file needs ADMIN OPTION on it.
GRANT common_verify_caller TO kusabi_save_function_owner, kusabi_query_function_owner;

-- 0002 switches to the three owner roles with SET ROLE.
GRANT kusabi_owner, kusabi_save_function_owner, kusabi_query_function_owner TO :"migration_role" WITH SET TRUE;

GRANT CREATE ON DATABASE :"database" TO kusabi_owner;

DO $$
BEGIN
  IF NOT has_database_privilege('kusabi_owner', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'kusabi:owner_cannot_create';
  END IF;
END
$$;

COMMIT;
