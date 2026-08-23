-- Guided-help prompt for File a Case → /cases chat kickoff
ALTER TABLE public.case_filing_templates
  ADD COLUMN IF NOT EXISTS action_prompt text NOT NULL DEFAULT '';
