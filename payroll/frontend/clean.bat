@echo off
if exist .next rmdir /s /q .next
if exist .next echo Cleaned .next folder
if not exist .next echo No .next folder found
pause


