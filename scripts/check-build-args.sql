SELECT name, 
       "buildArgs",
       "autoBuildArgs"
FROM application 
WHERE name LIKE '%frontend%'
ORDER BY name;
