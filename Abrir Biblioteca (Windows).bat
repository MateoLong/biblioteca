@echo off
REM Doble clic para abrir la biblioteca. Deja esta ventana abierta mientras la usas.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 app\server.py) || (python app\server.py)
pause
