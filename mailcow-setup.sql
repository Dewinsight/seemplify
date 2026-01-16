-- Add domain
INSERT INTO domain (domain, description, aliases, mailboxes, defquota, maxquota, quota, active) 
VALUES ('seemplifyai.com', 'Main company domain', 100, 50, 10240, 10240, 102400, 1);

-- Add admin@seemplifyai.com mailbox
INSERT INTO mailbox (username, password, name, maildir, quota, local_part, domain, active, created, modified)
VALUES ('admin@seemplifyai.com', '{BLF-CRYPT}$2y$05$RoundsSaltHashPasswordHere', 'Administrator', 'seemplifyai.com/admin/', 10240, 'admin', 'seemplifyai.com', 1, NOW(), NOW());

-- Add info@seemplifyai.com mailbox  
INSERT INTO mailbox (username, password, name, maildir, quota, local_part, domain, active, created, modified)
VALUES ('info@seemplifyai.com', '{BLF-CRYPT}$2y$05$RoundsSaltHashPasswordHere', 'Information', 'seemplifyai.com/info/', 10240, 'info', 'seemplifyai.com', 1, NOW(), NOW());
