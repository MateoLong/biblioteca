#!/bin/bash
# Doble clic para abrir la biblioteca. Dejá esta ventana abierta mientras la usás.
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Falta Python 3. Pedile a Mateo que lo instale (o abrí https://www.python.org/downloads/)."
  read -r -p "Apretá Enter para cerrar." _
  exit 1
fi
python3 app/server.py
