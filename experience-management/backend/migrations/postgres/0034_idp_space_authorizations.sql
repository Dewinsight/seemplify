CREATE TABLE IF NOT EXISTS idp_space_authorizations (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  authorization_revision INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(space_id,user_id),
  CONSTRAINT idp_space_authorizations_membership_fk
    FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idp_space_authorizations_revision
  ON idp_space_authorizations(authorization_revision,updated_at);
