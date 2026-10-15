#!/bin/sh
# The box on a TV, from a Raspberry Pi: wait until the box server answers, then show it
# full-screen in Chromium; if Chromium ever quits, it comes back.
#   Set SERVER to the computer running `npm start` (HOST=0.0.0.0), e.g.
#   SERVER=http://my-mac.local:8640
# Start it from ~/.config/labwc/autostart:   /home/<you>/tivo/kiosk.sh &
SERVER="${SERVER:-http://box-server.local:8640}"
URL="$SERVER/?fit=fill&kiosk=1"
while true; do
  until curl -fsS -o /dev/null --max-time 3 "$SERVER/"; do sleep 3; done
  chromium --ozone-platform=wayland --kiosk --incognito --noerrdialogs --disable-infobars --password-store=basic \
    --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 \
    --disable-features=Translate "$URL"
  sleep 2
done
