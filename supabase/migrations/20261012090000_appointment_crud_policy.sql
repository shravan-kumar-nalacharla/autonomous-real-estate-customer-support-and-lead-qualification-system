-- Keep database permissions aligned with the appointment API role guard.
DROP POLICY IF EXISTS "Managers can write appointments" ON appointments;
CREATE POLICY "Managers can write appointments"
  ON appointments FOR ALL TO authenticated
  USING (public.has_organization_role(organization_id, ARRAY['owner','admin','manager','agent']))
  WITH CHECK (public.has_organization_role(organization_id, ARRAY['owner','admin','manager','agent']));

NOTIFY pgrst, 'reload schema';
