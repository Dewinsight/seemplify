SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'apikey';

SELECT * FROM apikey LIMIT 1;
