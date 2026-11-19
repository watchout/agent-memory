-- 0001_roles (down): the reverse of 0001_roles.up.sql, in the reverse order. Run 0002_schema.down.sql first.
-- `common_verify_caller` belongs to the common infrastructure and is never dropped here.
-- Run with psql -v ON_ERROR_STOP=1 -v migration_role=<role that ran 0001> -v database=<database name>.
BEGIN;

REVOKE CREATE ON DATABASE :"database" FROM kusabi_owner;
REVOKE common_verify_caller FROM kusabi_save_function_owner, kusabi_query_function_owner;
REVOKE kusabi_owner, kusabi_save_function_owner, kusabi_query_function_owner FROM :"migration_role";

DROP ROLE kusabi_seat;
DROP ROLE kusabi_query_function_owner;
DROP ROLE kusabi_save_function_owner;
DROP ROLE kusabi_owner;

COMMIT;
