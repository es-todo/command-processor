#!/bin/bash 
echo "Hello World!"

function do_exit() {
  echo "Exiting ..."
  echo "Done."
}
trap do_exit SIGTERM SIGINT SIGHUP

./node_modules/.bin/nodemon --ext ts --watch src --exec 'node ./src/main.ts' &

sleep infinity &
wait $!
