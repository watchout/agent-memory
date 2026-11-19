-- 0002_schema (up): schema `kusabi`, three tables, their guards, and the four functions a seat reaches them through.
-- Needs 0001_roles. Run with psql -v ON_ERROR_STOP=1 as the migration role (it holds SET on the three owner roles).
-- One transaction: a failure part way leaves no schema, table, function or temporary CREATE grant behind.
BEGIN;

-- Tables, indexes, guards and policies belong to kusabi_owner, which owns no function.
SET LOCAL ROLE kusabi_owner;

CREATE SCHEMA kusabi;
REVOKE ALL ON SCHEMA kusabi FROM PUBLIC;

CREATE TABLE kusabi.decision_status (
  id uuid NOT NULL,
  code text NOT NULL,
  retired_at timestamptz,
  CONSTRAINT pk_decision_status PRIMARY KEY (id),
  CONSTRAINT unique_decision_status_code UNIQUE (code),
  CONSTRAINT check_decision_status_code_shape CHECK (code ~ '^[a-z][a-z0-9_]*$' AND length(code) <= 64)
);
INSERT INTO kusabi.decision_status (id, code) VALUES ('019a0f00-0000-7000-8000-000000000001', 'active');

CREATE TABLE kusabi.decision (
  id uuid NOT NULL,
  scope_id uuid NOT NULL,
  principal_ref text NOT NULL,
  seat_ref text NOT NULL,
  binding_ref text NOT NULL,
  binding_generation bigint NOT NULL,
  status_id uuid NOT NULL,
  decision_text text NOT NULL,
  context_text text,
  project_name text,
  created_at timestamptz NOT NULL,
  CONSTRAINT pk_decision PRIMARY KEY (id),
  CONSTRAINT fk_decision_status_id_decision_status FOREIGN KEY (status_id) REFERENCES kusabi.decision_status (id) ON DELETE RESTRICT,
  CONSTRAINT unique_decision_scope_id_and_id UNIQUE (scope_id, id),
  CONSTRAINT check_decision_id_shape CHECK ((uuid_extract_version(id) = 7) IS TRUE),
  CONSTRAINT check_decision_principal_ref_shape CHECK (principal_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT check_decision_seat_ref_shape CHECK (seat_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT check_decision_binding_ref_shape CHECK (binding_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT check_decision_binding_generation_range CHECK (binding_generation >= 1 AND binding_generation <= 9007199254740991),
  CONSTRAINT check_decision_decision_text_length CHECK (length(decision_text) >= 1 AND length(decision_text) <= 8000),
  CONSTRAINT check_decision_context_text_length CHECK (context_text IS NULL OR (length(context_text) >= 1 AND length(context_text) <= 8000)),
  CONSTRAINT check_decision_project_name_length CHECK (project_name IS NULL OR (length(project_name) >= 1 AND length(project_name) <= 200))
);
CREATE INDEX index_decision_on_scope_id_and_seat_ref_and_created_at_and_id ON kusabi.decision (scope_id, seat_ref, created_at DESC, id DESC);
CREATE INDEX index_decision_on_status_id ON kusabi.decision (status_id);

CREATE TABLE kusabi.decision_tag (
  id uuid NOT NULL,
  scope_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  tag_text text NOT NULL,
  CONSTRAINT pk_decision_tag PRIMARY KEY (id),
  CONSTRAINT fk_decision_tag_scope_id_and_decision_id_decision FOREIGN KEY (scope_id, decision_id) REFERENCES kusabi.decision (scope_id, id) ON DELETE RESTRICT,
  CONSTRAINT unique_decision_tag_scope_id_and_decision_id_and_tag_text UNIQUE (scope_id, decision_id, tag_text),
  CONSTRAINT check_decision_tag_id_shape CHECK ((uuid_extract_version(id) = 7) IS TRUE),
  CONSTRAINT check_decision_tag_tag_text_length CHECK (length(tag_text) >= 1 AND length(tag_text) <= 64)
);

-- A decision is never deleted and never rewritten; only its status may change (a later unit).
CREATE FUNCTION kusabi.trigger_decision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'status_id') IS DISTINCT FROM (to_jsonb(OLD) - 'status_id') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'kusabi:decision_is_not_rewritten';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trigger_decision_guard BEFORE UPDATE OR DELETE ON kusabi.decision
  FOR EACH ROW EXECUTE FUNCTION kusabi.trigger_decision_guard();

CREATE FUNCTION kusabi.trigger_decision_tag_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'kusabi:decision_tag_is_not_rewritten';
END
$$;
CREATE TRIGGER trigger_decision_tag_guard BEFORE UPDATE OR DELETE ON kusabi.decision_tag
  FOR EACH ROW EXECUTE FUNCTION kusabi.trigger_decision_tag_guard();

-- The scope is set by a function after the verification, per transaction; a table read without it stops with an error.
ALTER TABLE kusabi.decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE kusabi.decision FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_decision_scope ON kusabi.decision TO kusabi_save_function_owner, kusabi_query_function_owner
  USING (scope_id = current_setting('kusabi.scope_id')::uuid) WITH CHECK (scope_id = current_setting('kusabi.scope_id')::uuid);
ALTER TABLE kusabi.decision_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE kusabi.decision_tag FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_decision_tag_scope ON kusabi.decision_tag TO kusabi_save_function_owner, kusabi_query_function_owner
  USING (scope_id = current_setting('kusabi.scope_id')::uuid) WITH CHECK (scope_id = current_setting('kusabi.scope_id')::uuid);

GRANT USAGE ON SCHEMA kusabi TO kusabi_save_function_owner, kusabi_query_function_owner, kusabi_seat;
GRANT SELECT, INSERT ON kusabi.decision, kusabi.decision_tag TO kusabi_save_function_owner;
GRANT SELECT ON kusabi.decision_status TO kusabi_save_function_owner;
GRANT SELECT ON kusabi.decision, kusabi.decision_tag, kusabi.decision_status TO kusabi_query_function_owner;
-- Taken off again at the end, so the function owners cannot create anything afterwards.
GRANT CREATE ON SCHEMA kusabi TO kusabi_save_function_owner, kusabi_query_function_owner;

-- The seat check every function runs after the verification and before it reads or writes. It touches no table.
SET LOCAL ROLE kusabi_query_function_owner;
CREATE FUNCTION kusabi.require_verified_seat(p_seat_ref text, p_binding_ref text, p_binding_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF p_seat_ref IS NULL OR p_seat_ref = '' THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'kusabi:seat_not_registered';
  END IF;
  IF p_binding_ref IS NULL OR p_binding_ref = '' OR p_binding_generation IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'kusabi:binding_closed';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION kusabi.require_verified_seat(text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kusabi.require_verified_seat(text, text, bigint) TO kusabi_save_function_owner;

-- Write: verify as 'save', check the seat, set the scope, then insert the decision and its tags in the same transaction.
SET LOCAL ROLE kusabi_save_function_owner;
CREATE FUNCTION kusabi.log_decision(
  p_verify_context json, p_scope_id text, p_expected_actor json,
  p_decision_id uuid, p_decision_text text, p_context_text text, p_project_name text,
  p_tag_ids uuid[], p_tag_texts text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kusabi, pg_temp AS $$
DECLARE
  v_actor jsonb;
  v_status uuid;
BEGIN
  v_actor := common.verify_current_tx(p_verify_context, p_scope_id, p_expected_actor, 'save', '[]'::json, '[]'::json, '[]'::json) -> 'actor';
  PERFORM kusabi.require_verified_seat(v_actor ->> 'seat_id', v_actor ->> 'binding_id', (v_actor ->> 'binding_generation')::bigint);
  PERFORM set_config('kusabi.scope_id', v_actor ->> 'scope_id', true);
  SELECT id INTO STRICT v_status FROM kusabi.decision_status WHERE code = 'active';
  IF p_tag_ids IS NULL OR p_tag_texts IS NULL OR cardinality(p_tag_ids) <> cardinality(p_tag_texts) OR cardinality(p_tag_ids) > 20 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kusabi:invalid_input';
  END IF;
  INSERT INTO kusabi.decision (id, scope_id, principal_ref, seat_ref, binding_ref, binding_generation, status_id,
                               decision_text, context_text, project_name, created_at)
  VALUES (p_decision_id, (v_actor ->> 'scope_id')::uuid, v_actor ->> 'principal_id', v_actor ->> 'seat_id',
          v_actor ->> 'binding_id', (v_actor ->> 'binding_generation')::bigint, v_status,
          p_decision_text, p_context_text, p_project_name, to_timestamp((v_actor ->> 'observed_at_ms')::bigint / 1000.0));
  INSERT INTO kusabi.decision_tag (id, scope_id, decision_id, tag_text)
  SELECT t.id, (v_actor ->> 'scope_id')::uuid, p_decision_id, t.tag_text FROM unnest(p_tag_ids, p_tag_texts) AS t(id, tag_text);
  RETURN jsonb_build_object('decision_id', p_decision_id, 'created_at_ms', (v_actor ->> 'observed_at_ms')::bigint);
END
$$;
REVOKE ALL ON FUNCTION kusabi.log_decision(json, text, json, uuid, text, text, text, uuid[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kusabi.log_decision(json, text, json, uuid, text, text, text, uuid[], text[]) TO kusabi_seat;

-- Read: verify as 'query', check the seat, set the scope, then the active decisions of this seat, newest first.
SET LOCAL ROLE kusabi_query_function_owner;
CREATE FUNCTION kusabi.get_decisions(
  p_verify_context json, p_scope_id text, p_expected_actor json, p_project_name text, p_tag_texts text[], p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kusabi, pg_temp AS $$
DECLARE
  v_actor jsonb;
  v_decisions jsonb;
BEGIN
  v_actor := common.verify_current_tx(p_verify_context, p_scope_id, p_expected_actor, 'query', '[]'::json, '[]'::json, '[]'::json) -> 'actor';
  PERFORM kusabi.require_verified_seat(v_actor ->> 'seat_id', v_actor ->> 'binding_id', (v_actor ->> 'binding_generation')::bigint);
  PERFORM set_config('kusabi.scope_id', v_actor ->> 'scope_id', true);
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kusabi:invalid_input';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at_ms DESC, r.id DESC), '[]'::jsonb) INTO v_decisions
  FROM (
    SELECT d.id, d.decision_text, d.context_text, d.project_name, s.code AS status,
           floor(extract(epoch FROM d.created_at) * 1000)::bigint AS created_at_ms,
           coalesce((SELECT jsonb_agg(t.tag_text ORDER BY t.tag_text) FROM kusabi.decision_tag t
                     WHERE t.scope_id = d.scope_id AND t.decision_id = d.id), '[]'::jsonb) AS tags
    FROM kusabi.decision d JOIN kusabi.decision_status s ON s.id = d.status_id
    WHERE d.scope_id = (v_actor ->> 'scope_id')::uuid AND d.seat_ref = v_actor ->> 'seat_id' AND s.code = 'active'
      AND (p_project_name IS NULL OR d.project_name = p_project_name)
      AND (p_tag_texts IS NULL OR cardinality(p_tag_texts) = 0 OR EXISTS (
            SELECT 1 FROM kusabi.decision_tag t WHERE t.scope_id = d.scope_id AND t.decision_id = d.id AND t.tag_text = ANY (p_tag_texts)))
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT p_limit
  ) r;
  RETURN jsonb_build_object('decisions', v_decisions, 'verified', jsonb_build_object(
    'scope_id', v_actor -> 'scope_id', 'principal_ref', v_actor -> 'principal_id', 'seat_ref', v_actor -> 'seat_id',
    'binding_ref', v_actor -> 'binding_id', 'binding_generation', v_actor -> 'binding_generation'));
END
$$;
REVOKE ALL ON FUNCTION kusabi.get_decisions(json, text, json, text, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kusabi.get_decisions(json, text, json, text, text[], integer) TO kusabi_seat;

-- Recover: the same seat's newest active decisions and how many active decisions it has in all.
CREATE FUNCTION kusabi.recover_decisions(
  p_verify_context json, p_scope_id text, p_expected_actor json, p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, kusabi, pg_temp AS $$
DECLARE
  v_actor jsonb;
  v_decisions jsonb;
  v_total bigint;
BEGIN
  v_actor := common.verify_current_tx(p_verify_context, p_scope_id, p_expected_actor, 'query', '[]'::json, '[]'::json, '[]'::json) -> 'actor';
  PERFORM kusabi.require_verified_seat(v_actor ->> 'seat_id', v_actor ->> 'binding_id', (v_actor ->> 'binding_generation')::bigint);
  PERFORM set_config('kusabi.scope_id', v_actor ->> 'scope_id', true);
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kusabi:invalid_input';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at_ms DESC, r.id DESC), '[]'::jsonb) INTO v_decisions
  FROM (
    SELECT d.id, d.decision_text, d.context_text, d.project_name, s.code AS status,
           floor(extract(epoch FROM d.created_at) * 1000)::bigint AS created_at_ms,
           coalesce((SELECT jsonb_agg(t.tag_text ORDER BY t.tag_text) FROM kusabi.decision_tag t
                     WHERE t.scope_id = d.scope_id AND t.decision_id = d.id), '[]'::jsonb) AS tags
    FROM kusabi.decision d JOIN kusabi.decision_status s ON s.id = d.status_id
    WHERE d.scope_id = (v_actor ->> 'scope_id')::uuid AND d.seat_ref = v_actor ->> 'seat_id' AND s.code = 'active'
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT p_limit
  ) r;
  SELECT count(*) INTO v_total FROM kusabi.decision d JOIN kusabi.decision_status s ON s.id = d.status_id
  WHERE d.scope_id = (v_actor ->> 'scope_id')::uuid AND d.seat_ref = v_actor ->> 'seat_id' AND s.code = 'active';
  RETURN jsonb_build_object('decisions', v_decisions, 'total_active_count', v_total, 'verified', jsonb_build_object(
    'scope_id', v_actor -> 'scope_id', 'principal_ref', v_actor -> 'principal_id', 'seat_ref', v_actor -> 'seat_id',
    'binding_ref', v_actor -> 'binding_id', 'binding_generation', v_actor -> 'binding_generation'));
END
$$;
REVOKE ALL ON FUNCTION kusabi.recover_decisions(json, text, json, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kusabi.recover_decisions(json, text, json, integer) TO kusabi_seat;

SET LOCAL ROLE kusabi_owner;
REVOKE CREATE ON SCHEMA kusabi FROM kusabi_save_function_owner, kusabi_query_function_owner;

COMMIT;
