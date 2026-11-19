-- 0002_schema (down): drops what 0002_schema.up.sql made, by name and in the reverse order, with no CASCADE.
-- kusabi_owner owns the schema, so it may also drop the functions the two function owners made.
-- Run with psql -v ON_ERROR_STOP=1 as the migration role. Run before 0001_roles.down.sql.
BEGIN;

SET LOCAL ROLE kusabi_owner;

DROP FUNCTION kusabi.recover_decisions(json, text, json, integer);
DROP FUNCTION kusabi.get_decisions(json, text, json, text, text[], integer);
DROP FUNCTION kusabi.log_decision(json, text, json, uuid, text, text, text, uuid[], text[]);
DROP FUNCTION kusabi.require_verified_seat(text, text, bigint);

DROP POLICY policy_decision_tag_scope ON kusabi.decision_tag;
DROP POLICY policy_decision_scope ON kusabi.decision;
DROP TRIGGER trigger_decision_tag_guard ON kusabi.decision_tag;
DROP TRIGGER trigger_decision_guard ON kusabi.decision;
DROP FUNCTION kusabi.trigger_decision_tag_guard();
DROP FUNCTION kusabi.trigger_decision_guard();

DROP TABLE kusabi.decision_tag;
DROP TABLE kusabi.decision;
DROP TABLE kusabi.decision_status;
DROP SCHEMA kusabi;

COMMIT;
