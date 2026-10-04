#!/bin/bash
# Serves the app from this Mac so you can try it here or on an iPad on the same Wi-Fi.
# (Her real copy will open from its web address; this is only for testing.)
cd "$(dirname "$0")/app/static"
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo ""
echo "  En esta Mac:   http://localhost:8765"
[ -n "$IP" ] && echo "  En el iPad:    http://$IP:8765   (mismo Wi-Fi)"
echo ""
echo "  Dejá esta ventana abierta mientras probás. Para cerrar: Ctrl+C."
echo ""
(sleep 1 && open "http://localhost:8765") &
python3 -m http.server 8765 --bind 0.0.0.0 >/dev/null 2>&1
