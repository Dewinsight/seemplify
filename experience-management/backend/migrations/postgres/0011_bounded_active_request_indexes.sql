-- Runtime schema 11: keep active AI-request uniqueness keys within PostgreSQL
-- B-tree row limits. Exact request equality remains checked by the application;
-- the built-in MD5 digest only bounds immutable text components in the index.

DROP INDEX IF EXISTS social_reply_drafts_one_active_request;
CREATE UNIQUE INDEX social_reply_drafts_one_active_request
  ON social_reply_drafts(space_id,requested_by,mention_id,tone,md5(instructions))
  WHERE state='queued';

DROP INDEX IF EXISTS social_intelligence_reports_one_active_request;
CREATE UNIQUE INDEX social_intelligence_reports_one_active_request
  ON social_intelligence_reports(space_id,user_id,connection_id,title,md5(mention_ids_json))
  WHERE state='queued';

DROP INDEX IF EXISTS intelligence_reports_one_active_request;
CREATE UNIQUE INDEX intelligence_reports_one_active_request
  ON intelligence_reports(space_id,user_id,title,md5(objective),md5(source_refs_json),md5(knowledge_refs_json))
  WHERE state='queued';
