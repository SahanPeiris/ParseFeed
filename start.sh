#!/bin/bash
export PORT=9000;
node ./bin/www >> msg.log 2>> err.log &
