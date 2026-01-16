SELECT name, "buildArgs"
FROM application 
WHERE name LIKE '%frontend%'
ORDER BY name;
