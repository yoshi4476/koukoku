-- alert_rules / alert_events: テナント分離 (F-13)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['alert_rules', 'alert_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_setting(''app.tenant_id'', true))
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END
$$;
