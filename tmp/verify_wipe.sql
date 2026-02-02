SELECT 'user_count' as metric, count(*) as value FROM zerver_userprofile;
SELECT 'realm_count' as metric, count(*) as value FROM zerver_realm;
SELECT 'stream_count' as metric, count(*) as value FROM zerver_stream;
SELECT 'message_count' as metric, count(*) as value FROM zerver_message;
