-- Add _dev suffix to identity and recruiter databases

-- Identity Provider - change 'identity' to 'identity_dev'
UPDATE application
SET env = REPLACE(env, 
    'mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/identity?',
    'mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/identity_dev?')
WHERE name = 'identity-provider-dev';

-- Recruiter Backend - change 'smart_hr_db' to 'smart_hr_db_dev'
UPDATE application
SET env = REPLACE(env,
    'mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/smart_hr_db?',
    'mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/smart_hr_db_dev?')
WHERE name = 'recruiter-backend-dev';

-- Verify changes
SELECT name,
       SUBSTRING(env FROM 'mongodb[^?]+') as mongo_db_name
FROM application
WHERE name IN ('identity-provider-dev', 'recruiter-backend-dev')
ORDER BY name;
