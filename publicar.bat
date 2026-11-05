@echo off
cd /d "%~dp0"
echo Enviando alteracoes ao GitHub...
git add -A
git commit -m "Atualizacao" 2>nul
git push origin main
if errorlevel 1 (echo. & echo FALHOU - veja a mensagem acima & pause & exit /b 1)
echo.
echo Enviado com sucesso. Avise o Claude para reiniciar no Coolify.
pause
